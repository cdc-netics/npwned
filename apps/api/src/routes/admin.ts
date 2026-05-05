/**
 * API de administración: autenticación por JWT y gestión básica de incidentes.
 */
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { config } from "../config.js";
import { getDb, col } from "../db.js";
import { limiteLoginAdmin } from "../middleware/rateLimits.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import {
  normalizeEmailForLeakLine,
  normalizeForeignOrGenericNationalId,
  normalizeLeakDisplayName,
  normalizeInternalSystemId,
  normalizeLeakUsername,
  normalizeRutCl,
} from "../normalizers.js";
import { analyticsRouter } from "./analytics.js";
import { hasBinaryOrBidiGarbage, tryParseObjectIdHex } from "../validation/inputGuards.js";

export const adminRouter = Router();

const loginSchema = z
  .object({
    username: z.string().min(1).max(128),
    password: z.string().min(1).max(256),
  })
  .refine((b) => !hasBinaryOrBidiGarbage(b.username) && !hasBinaryOrBidiGarbage(b.password), {
    message: "Caracteres no permitidos.",
    path: ["username"],
  });

/** Emite un JWT si las credenciales coinciden con un documento en `admins`. */
adminRouter.post("/login", limiteLoginAdmin, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body" });
    return;
  }
  const { username, password } = parsed.data;
  const db = await getDb();
  const user = await db.collection(col.admins).findOne({ username });
  if (!user || typeof user.passwordHash !== "string") {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }
  const token = jwt.sign(
    { sub: String(user._id), role: "admin" as const },
    config.jwtSecret,
    { expiresIn: "12h" },
  );
  res.json({ token, expiresInHours: 12 });
});

/** Comprueba que el token sigue siendo válido. */
adminRouter.get("/me", requireAdmin, (req, res) => {
  res.json({ sub: req.admin?.sub, role: req.admin?.role });
});

const crearUsuarioSchema = z
  .object({
    username: z.string().min(2).max(64).regex(/^[a-zA-Z0-9._-]+$/),
    password: z.string().min(12).max(200),
  })
  .refine((b) => !hasBinaryOrBidiGarbage(b.username) && !hasBinaryOrBidiGarbage(b.password), {
    message: "Caracteres no permitidos.",
    path: ["username"],
  });

/**
 * Lista cuentas de administrador (sin hashes ni secretos).
 */
adminRouter.get("/users", requireAdmin, async (_req, res) => {
  const db = await getDb();
  const list = await db
    .collection(col.admins)
    .find({})
    .project({ username: 1, createdAt: 1, createdBy: 1 })
    .sort({ createdAt: 1 })
    .limit(200)
    .toArray();
  res.json({
    items: list.map((u) => ({
      id: String(u._id),
      username: u.username,
      createdAt: u.createdAt ?? null,
      createdBy: u.createdBy ? String(u.createdBy) : null,
    })),
  });
});

/**
 * Crea otro usuario administrador (requiere sesión admin). La contraseña nunca se almacena en claro.
 */
adminRouter.post("/users", requireAdmin, async (req, res) => {
  const parsed = crearUsuarioSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }
  const db = await getDb();
  const exists = await db.collection(col.admins).findOne({ username: parsed.data.username });
  if (exists) {
    res.status(409).json({ error: "username_exists", message: "Ese nombre de usuario ya existe." });
    return;
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  let createdBy: ObjectId;
  try {
    createdBy = new ObjectId(req.admin!.sub);
  } catch {
    res.status(401).json({ error: "invalid_token" });
    return;
  }
  const r = await db.collection(col.admins).insertOne({
    username: parsed.data.username,
    passwordHash,
    createdAt: new Date(),
    createdBy,
  });
  res.status(201).json({ id: String(r.insertedId) });
});

/** Lista incidentes conocidos (metadatos, sin filas de filtración crudas). */
adminRouter.get("/breaches", requireAdmin, async (_req, res) => {
  const db = await getDb();
  const list = await db
    .collection(col.breachSources)
    .find({})
    .project({ name: 1, slug: 1, incidentDate: 1, createdAt: 1, tags: 1 })
    .sort({ createdAt: -1 })
    .limit(500)
    .toArray();
  res.json({
    items: list.map((b) => ({
      id: String(b._id),
      name: b.name,
      slug: b.slug,
      incidentDate: b.incidentDate ?? null,
      createdAt: b.createdAt ?? null,
      tags: Array.isArray(b.tags) ? b.tags.map(String) : [],
    })),
  });
});

const tagSchema = z
  .string()
  .max(48)
  .transform((s) => s.trim())
  .refine((s) => s.length > 0, "tag vacío");

const createBreachSchema = z
  .object({
    name: z.string().min(2).max(200),
    slug: z.string().min(2).max(120).regex(/^[a-z0-9-]+$/),
    incidentDate: z.string().max(40).optional(),
    description: z.string().max(2000).optional(),
    /** Etiquetas libres (p. ej. sector, año, fuente); se muestran al usuario en la consulta pública. */
    tags: z.array(tagSchema).max(24).optional(),
  })
  .superRefine((d, ctx) => {
    if (hasBinaryOrBidiGarbage(d.name)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Caracteres no permitidos.", path: ["name"] });
    }
    if (d.description && hasBinaryOrBidiGarbage(d.description)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Caracteres no permitidos.", path: ["description"] });
    }
    if (d.incidentDate && hasBinaryOrBidiGarbage(d.incidentDate)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Caracteres no permitidos.", path: ["incidentDate"] });
    }
    const tags = d.tags ?? [];
    for (let i = 0; i < tags.length; i++) {
      if (hasBinaryOrBidiGarbage(tags[i])) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Caracteres no permitidos.", path: ["tags", i] });
      }
    }
  });

/** Crea un nuevo registro de incidente; el `slug` debe ser único. */
adminRouter.post("/breaches", requireAdmin, async (req, res) => {
  const parsed = createBreachSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }
  const db = await getDb();
  const exists = await db.collection(col.breachSources).findOne({ slug: parsed.data.slug });
  if (exists) {
    res.status(409).json({ error: "slug_exists" });
    return;
  }
  const incidentDate =
    parsed.data.incidentDate && !Number.isNaN(Date.parse(parsed.data.incidentDate))
      ? new Date(parsed.data.incidentDate)
      : null;

  const tags =
    parsed.data.tags && parsed.data.tags.length > 0
      ? [...new Set(parsed.data.tags.map((t) => t.trim()).filter(Boolean))]
      : [];

  const doc = {
    name: parsed.data.name,
    slug: parsed.data.slug,
    incidentDate,
    description: parsed.data.description ?? null,
    tags,
    createdAt: new Date(),
  };
  const r = await db.collection(col.breachSources).insertOne(doc);
  res.status(201).json({ id: String(r.insertedId) });
});

const deleteBreachCascadeSchema = z.object({
  breachId: z.string().regex(/^[a-f0-9]{24}$/i),
  /** El cliente debe enviar `true` tras confirmación explícita en UI (no basta omitir el campo). */
  confirmDelete: z.literal(true),
});

/**
 * Elimina un incidente y **todas** sus filas en `leak_index` (`deleteMany` por `breachId`).
 * No borra `search_events` (histórico de consultas); opcional en el futuro.
 */
adminRouter.post("/breaches/delete-with-index", requireAdmin, async (req, res) => {
  const parsed = deleteBreachCascadeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }
  const oid = tryParseObjectIdHex(parsed.data.breachId);
  if (!oid) {
    res.status(400).json({ error: "invalid_breach_id" });
    return;
  }
  const db = await getDb();
  const breach = await db.collection(col.breachSources).findOne({ _id: oid });
  if (!breach) {
    res.status(404).json({ error: "breach_not_found" });
    return;
  }
  const slug = String(breach.slug ?? "");

  const leakRes = await db.collection(col.leakIndex).deleteMany({ breachId: oid });
  const srcRes = await db.collection(col.breachSources).deleteOne({ _id: oid });
  res.json({
    ok: true,
    leakIndexDeletedCount: leakRes.deletedCount,
    breachDeleted: srcRes.deletedCount === 1,
    slug,
  });
});

const deleteLeakIndexEntrySchema = z
  .object({
    breachId: z.string().regex(/^[a-f0-9]{24}$/i),
    type: z.enum(["email", "rut_cl", "username", "display_name", "national_id", "internal_id"]),
    value: z.string().min(1).max(400),
  })
  .refine((b) => !hasBinaryOrBidiGarbage(b.value), {
    message: "Caracteres no permitidos en el valor.",
    path: ["value"],
  });

/**
 * Quita una fila concreta de `leak_index` (mismo tipo y valor canónico que usa la ingesta).
 * Útil para corregir datos indexados por error.
 */
adminRouter.post("/leak-index/delete-entry", requireAdmin, async (req, res) => {
  const parsed = deleteLeakIndexEntrySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }
  const breachOid = tryParseObjectIdHex(parsed.data.breachId);
  if (!breachOid) {
    res.status(400).json({ error: "invalid_breach_id" });
    return;
  }
  const { type, value: rawVal } = parsed.data;
  let canonical: string | null = null;
  if (type === "email") canonical = normalizeEmailForLeakLine(rawVal);
  else if (type === "rut_cl") canonical = normalizeRutCl(rawVal);
  else if (type === "username") canonical = normalizeLeakUsername(rawVal);
  else if (type === "display_name") canonical = normalizeLeakDisplayName(rawVal);
  else if (type === "national_id") canonical = normalizeForeignOrGenericNationalId(rawVal);
  else canonical = normalizeInternalSystemId(rawVal);

  if (!canonical) {
    res.status(400).json({ error: "invalid_value", message: "El valor no se puede normalizar como ese tipo." });
    return;
  }

  const db = await getDb();
  const breach = await db.collection(col.breachSources).findOne({ _id: breachOid });
  if (!breach) {
    res.status(404).json({ error: "breach_not_found" });
    return;
  }

  const r = await db.collection(col.leakIndex).deleteOne({
    breachId: breachOid,
    type,
    value: canonical,
  });
  res.json({ ok: true, deletedCount: r.deletedCount });
});

/** Analítica de búsquedas (resúmenes y materialización diaria). */
adminRouter.use("/analytics", analyticsRouter);
