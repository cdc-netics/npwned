/**
 * API pública: comprobación de filtraciones sin autenticación.
 * Registra cada consulta en `search_events` para analítica agregada.
 *
 * Consultas a MongoDB usan filtros BSON (sin SQL); los `RegExp` que construimos escapan el input
 * (`escapeRegExpChars` / `emailWildcardToRegExp`); no se usa `$where` ni cadenas de agregación con texto crudo.
 */
import { Router } from "express";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { getDb, col } from "../db.js";
import { limiteConsultaPublica } from "../middleware/rateLimits.js";
import {
  emailDomain,
  emailWildcardDomainHint,
  emailWildcardToRegExp,
  normalizeEmail,
  normalizeLeakDisplayName,
  normalizeLeakUsername,
  normalizeRutCl,
} from "../normalizers.js";
import { hasBinaryOrBidiGarbage, uniqueBreachObjectIdsFromRows } from "../validation/inputGuards.js";

const bodySchema = z
  .object({
    kind: z.enum(["email", "rut", "username", "display_name"]),
    value: z.string().min(2).max(400),
  })
  .refine((b) => !hasBinaryOrBidiGarbage(b.value), {
    message: "Caracteres no permitidos en el valor.",
    path: ["value"],
  });

/** Tope de filas del índice a recorrer en búsqueda de correo con comodines (coste acotado). */
const EMAIL_WILDCARD_ROW_CAP = 6000;
/** Mismo tope al buscar «usuario» también en correos cuyo local coincide (`nick` → `nick@dominio…`). */
const USERNAME_EMAIL_LOCAL_ROW_CAP = 6000;
/** Filas de índice a considerar al listar nombres coincidentes en consulta pública por nombre. */
const DISPLAY_NAME_PUBLIC_ROW_CAP = 6000;

/** Colación para comparar nombres: ignora mayúsculas/minúsculas; respeta tildes (es). */
const DISPLAY_NAME_COLLATION = { locale: "es", strength: 2 as const };

function escapeRegExpChars(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const publicRouter = Router();

publicRouter.get("/health", (_req, res) => {
  res.json({ ok: true });
});

publicRouter.post("/check", limiteConsultaPublica, async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "invalid_body",
      details: parsed.error.flatten(),
    });
    return;
  }

  const { kind, value } = parsed.data;
  const db = await getDb();

  let queryType: "email" | "rut_cl" | "username" | "display_name" = "email";
  let domain: string | undefined;
  type IdxRow = { breachId: unknown; value?: unknown };
  let rows: IdxRow[] = [];
  let wildcardEmail = false;
  let matchCountTruncated = false;
  let usernameEmailLocalTruncated = false;
  let usernameEmailMatches: string[] | undefined;
  let displayNameRowsTruncated = false;
  let displayNameMatches: string[] | undefined;

  if (kind === "email") {
    queryType = "email";
    const wild = emailWildcardToRegExp(value);
    if (wild) {
      wildcardEmail = true;
      domain = emailWildcardDomainHint(value);
      const foundRows = (await db
        .collection(col.leakIndex)
        .find({ type: "email", value: wild })
        .project({ breachId: 1, value: 1 })
        .limit(EMAIL_WILDCARD_ROW_CAP + 1)
        .toArray()) as IdxRow[];
      matchCountTruncated = foundRows.length > EMAIL_WILDCARD_ROW_CAP;
      rows = matchCountTruncated ? foundRows.slice(0, EMAIL_WILDCARD_ROW_CAP) : foundRows;
    } else {
      const normalized = normalizeEmail(value);
      if (!normalized) {
        await db.collection(col.searchEvents).insertOne({
          at: new Date(),
          queryType: "email",
          hit: false,
          breachCount: 0,
          invalid: true,
        });
        res.json({
          found: false,
          invalid: true,
          breaches: [],
        });
        return;
      }
      domain = emailDomain(normalized) ?? undefined;
      rows = (await db
        .collection(col.leakIndex)
        .find({ type: "email", value: normalized })
        .project({ breachId: 1 })
        .toArray()) as IdxRow[];
    }
  } else if (kind === "rut") {
    queryType = "rut_cl";
    const normalized = normalizeRutCl(value);
    if (!normalized) {
      await db.collection(col.searchEvents).insertOne({
        at: new Date(),
        queryType: "rut_cl",
        hit: false,
        breachCount: 0,
        invalid: true,
      });
      res.json({
        found: false,
        invalid: true,
        breaches: [],
      });
      return;
    }
    rows = (await db
      .collection(col.leakIndex)
      .find({ type: "rut_cl", value: normalized })
      .project({ breachId: 1 })
      .toArray()) as IdxRow[];
  } else if (kind === "username") {
    queryType = "username";
    const normalized = normalizeLeakUsername(value);
    if (!normalized) {
      await db.collection(col.searchEvents).insertOne({
        at: new Date(),
        queryType: "username",
        hit: false,
        breachCount: 0,
        invalid: true,
      });
      res.json({
        found: false,
        invalid: true,
        breaches: [],
      });
      return;
    }
    const rowUser = (await db
      .collection(col.leakIndex)
      .find({ type: "username", value: normalized })
      .project({ breachId: 1 })
      .toArray()) as IdxRow[];

    const emailLocalRe = new RegExp(`^${escapeRegExpChars(normalized)}@`, "i");
    const rowEmailRaw = (await db
      .collection(col.leakIndex)
      .find({ type: "email", value: emailLocalRe })
      .project({ breachId: 1, value: 1 })
      .limit(USERNAME_EMAIL_LOCAL_ROW_CAP + 1)
      .toArray()) as IdxRow[];

    usernameEmailLocalTruncated = rowEmailRaw.length > USERNAME_EMAIL_LOCAL_ROW_CAP;
    const rowEmail = usernameEmailLocalTruncated
      ? rowEmailRaw.slice(0, USERNAME_EMAIL_LOCAL_ROW_CAP)
      : rowEmailRaw;

    rows = [...rowUser, ...rowEmail];
    if (rowEmail.length > 0) {
      usernameEmailMatches = [...new Set(rowEmail.map((r) => String(r.value ?? "")).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, "und"),
      );
    }
  } else {
    queryType = "display_name";
    const normalized = normalizeLeakDisplayName(value);
    if (!normalized) {
      await db.collection(col.searchEvents).insertOne({
        at: new Date(),
        queryType: "display_name",
        hit: false,
        breachCount: 0,
        invalid: true,
      });
      res.json({
        found: false,
        invalid: true,
        breaches: [],
      });
      return;
    }
    const rowDnRaw = (await db
      .collection(col.leakIndex)
      .find({ type: "display_name", value: normalized })
      .collation(DISPLAY_NAME_COLLATION)
      .project({ breachId: 1, value: 1 })
      .limit(DISPLAY_NAME_PUBLIC_ROW_CAP + 1)
      .toArray()) as IdxRow[];

    displayNameRowsTruncated = rowDnRaw.length > DISPLAY_NAME_PUBLIC_ROW_CAP;
    rows = displayNameRowsTruncated ? rowDnRaw.slice(0, DISPLAY_NAME_PUBLIC_ROW_CAP) : rowDnRaw;
    if (rows.length > 0) {
      displayNameMatches = [...new Set(rows.map((r) => String(r.value ?? "")).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "es", { sensitivity: "accent" }),
      );
    }
  }

  const oids = uniqueBreachObjectIdsFromRows(rows);

  const breaches =
    oids.length === 0
      ? []
      : await db
          .collection(col.breachSources)
          .find({ _id: { $in: oids } })
          .project({ name: 1, slug: 1, incidentDate: 1, description: 1, tags: 1 })
          .sort({ incidentDate: -1 })
          .toArray();

  const found = breaches.length > 0;
  const breachSlugs = found
    ? [...new Set(breaches.map((b) => String(b.slug)).filter(Boolean))].sort()
    : [];

  /** Direcciones completas únicas en el tramo escaneado (mismo tope que `matchCount`). */
  let wildcardEmails: string[] | undefined;
  if (wildcardEmail && rows.length > 0) {
    const emails = [...new Set(rows.map((r) => String(r.value ?? "")).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "und"),
    );
    wildcardEmails = emails;
  }

  await db.collection(col.searchEvents).insertOne({
    at: new Date(),
    queryType,
    hit: found,
    breachCount: breaches.length,
    breachSlugs: breachSlugs.length ? breachSlugs : undefined,
    domain,
    invalid: false,
    ...(wildcardEmail
      ? {
          wildcardEmail: true,
          emailMatchCount: rows.length,
          emailWildcardTruncated: matchCountTruncated,
        }
      : {}),
    ...(kind === "username" && usernameEmailMatches?.length
      ? {
          usernameEmailLocalMatchCount: usernameEmailMatches.length,
          usernameEmailLocalTruncated: usernameEmailLocalTruncated,
        }
      : {}),
    ...(kind === "display_name" && displayNameMatches?.length
      ? {
          displayNameRowCount: rows.length,
          displayNameRowsTruncated: displayNameRowsTruncated,
        }
      : {}),
  });

  res.json({
    found,
    invalid: false,
    breaches: breaches.map((b) => ({
      id: String(b._id),
      name: b.name,
      slug: b.slug,
      incidentDate: b.incidentDate ?? null,
      description: b.description ?? null,
      tags: Array.isArray(b.tags) ? b.tags.map(String) : [],
    })),
    ...(wildcardEmail
      ? {
          wildcard: true as const,
          matchCount: rows.length,
          matchCountTruncated,
          ...(wildcardEmails && wildcardEmails.length ? { emails: wildcardEmails } : {}),
        }
      : {}),
    ...(usernameEmailMatches && usernameEmailMatches.length
      ? {
          usernameEmailMatches,
          usernameEmailMatchesTruncated: usernameEmailLocalTruncated,
        }
      : {}),
    ...(displayNameMatches && displayNameMatches.length
      ? {
          displayNameMatches,
          displayNameMatchesTruncated: displayNameRowsTruncated,
        }
      : {}),
  });
});
