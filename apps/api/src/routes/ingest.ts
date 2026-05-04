/**
 * Ingesta de listas de fugas con **vista previa** y **confirmación** (evita indexar a ciegas).
 * El commit usa **streaming multipart** (Busboy): no guarda el archivo entero en disco; admite listas enormes.
 */
import busboy from "busboy";
import express, { Router } from "express";
import { z } from "zod";
import { getDb, col } from "../db.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import {
  normalizeUnknownIdentifier,
  peekLeakLineParse,
  type LeakLineExtractionMode,
} from "../ingestion/extractIdentifierFromLeakLine.js";
import { leakProfileSchema } from "../ingestion/ingestProfileZod.js";
import { ingestLinesFromReadable } from "../services/ingestBulk.js";
import { hasBinaryOrBidiGarbage, tryParseObjectIdHex } from "../validation/inputGuards.js";

export const ingestRouter = Router();

const MAX_PREVIEW_LINE_CHARS = 24_576;
/** Tope de caracteres en todas las líneas (JSON 32mb; margen bajo cuerpo total). */
const MAX_PREVIEW_TOTAL_CHARS = 14_000_000;

const previewBodySchema = z
  .object({
    lines: z.array(z.string().max(MAX_PREVIEW_LINE_CHARS)).max(2500),
    profile: leakProfileSchema,
  })
  .superRefine((data, ctx) => {
    let total = 0;
    for (const line of data.lines) {
      total += line.length;
    }
    if (total > MAX_PREVIEW_TOTAL_CHARS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Demasiado texto en conjunto (máx. ${MAX_PREVIEW_TOTAL_CHARS} caracteres).`,
        path: ["lines"],
      });
    }
  });

ingestRouter.post(
  "/preview-lines",
  /** Líneas largas en JSON escapan y crecen; margen holgado sobre ~1,8 MB de texto en cliente. */
  express.json({ limit: "32mb" }),
  requireAdmin,
  async (req, res) => {
    const parsed = previewBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
      return;
    }
    const { lines, profile } = parsed.data;
    const rows = lines.map((line, i) => peekLeakLineParse(line, i + 1, profile));
    const stats = {
      linesSubmitted: lines.length,
      ok: rows.filter((r) => r.status === "ok").length,
      skipLine: rows.filter((r) => r.status === "skip_line").length,
      noCell: rows.filter((r) => r.status === "no_cell").length,
      invalidId: rows.filter((r) => r.status === "invalid_id").length,
    };
    res.json({ stats, rows });
  },
);

const tryNormalizeSchema = z
  .object({
    candidate: z.string().max(500),
    detect: z.enum(["email_rut", "email_rut_plus_text"]).optional(),
  })
  .refine((b) => !hasBinaryOrBidiGarbage(b.candidate), {
    message: "Caracteres no permitidos en candidate.",
    path: ["candidate"],
  });

/** Prueba un texto con la misma lógica que la ingesta (incl. `detect` del perfil). */
ingestRouter.post(
  "/try-normalize",
  express.json({ limit: "64kb" }),
  requireAdmin,
  (req, res) => {
    const parsed = tryNormalizeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
      return;
    }
    const candidate = parsed.data.candidate.trim();
    const n = normalizeUnknownIdentifier(candidate, parsed.data.detect ?? "email_rut");
    if (!n) {
      res.json({ ok: false as const });
      return;
    }
    res.json({ ok: true as const, type: n.type, value: n.value });
  },
);

class IngestHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "IngestHttpError";
  }
}

ingestRouter.post("/commit", requireAdmin, (req, res) => {
  const ct = req.headers["content-type"] ?? "";
  if (!ct.toLowerCase().includes("multipart/form-data")) {
    res.status(400).json({ error: "expected_multipart_form_data" });
    return;
  }

  const bb = busboy({
    headers: req.headers,
    limits: {
      files: 1,
      parts: 48,
      /** Perfil JSON; holgado por si se amplía el esquema. */
      fieldSize: 2 * 1024 * 1024,
      /** Listas de fugas grandes por streaming (sin cargar todo en RAM del worker). */
      fileSize: 512 * 1024 * 1024,
    },
  });

  let breachIdStr = "";
  let profileStr = "";
  let ingestPromise: Promise<{ breachName: string; stats: Awaited<ReturnType<typeof ingestLinesFromReadable>> }> | null =
    null;

  bb.on("field", (name, val) => {
    const s: string = Buffer.isBuffer(val) ? val.toString("utf8") : String(val);
    if (name === "breachId") breachIdStr = s.trim();
    if (name === "profile") profileStr = s;
  });

  bb.on("file", (name, file) => {
    if (name !== "file") {
      file.resume();
      return;
    }
    ingestPromise = (async () => {
      if (!breachIdStr || !profileStr) {
        file.resume();
        throw new IngestHttpError(400, "missing_breach_or_profile_fields");
      }
      const breachId = tryParseObjectIdHex(breachIdStr);
      if (!breachId) {
        file.resume();
        throw new IngestHttpError(400, "invalid_breach_id");
      }
      let profile: LeakLineExtractionMode;
      try {
        const j = JSON.parse(profileStr) as unknown;
        const p = leakProfileSchema.safeParse(j);
        if (!p.success) {
          file.resume();
          throw new IngestHttpError(400, "invalid_profile");
        }
        profile = p.data;
      } catch (e) {
        file.resume();
        if (e instanceof IngestHttpError) throw e;
        throw new IngestHttpError(400, "invalid_profile_json");
      }

      const db = await getDb();
      const breach = await db.collection(col.breachSources).findOne({ _id: breachId });
      if (!breach) {
        file.resume();
        throw new IngestHttpError(404, "breach_not_found");
      }

      const stats = await ingestLinesFromReadable(db, breachId, profile, file);
      return { breachName: String(breach.name), stats };
    })();
  });

  bb.on("error", (err) => {
    if (!res.headersSent) {
      res.status(500).json({ error: "upload_parse_failed", message: String(err) });
    }
  });

  bb.on("finish", () => {
    void (async () => {
      if (res.headersSent) return;
      try {
        if (!ingestPromise) {
          res.status(400).json({ error: "missing_file" });
          return;
        }
        const { breachName, stats } = await ingestPromise;
        res.json({
          ok: true,
          breachId: breachIdStr,
          breachName,
          linesRead: stats.linesRead,
          linesSkipped: stats.linesSkipped,
          identifiersRecognized: stats.identifiersRecognized,
          upsertedNew: stats.upsertedNew,
          matchedExisting: stats.matchedExisting,
        });
      } catch (e) {
        if (res.headersSent) return;
        if (e instanceof IngestHttpError) {
          res.status(e.status).json({ error: e.message });
          return;
        }
        res.status(500).json({ error: "ingest_failed", message: String(e) });
      }
    })();
  });

  req.pipe(bb);
});
