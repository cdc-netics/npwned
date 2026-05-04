/**
 * Rutas admin: analítica de búsquedas (agregación y materialización diaria).
 */
import { Router } from "express";
import { z } from "zod";
import { getDb, col } from "../db.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import {
  getSearchOverview,
  materializeSearchStatsForDay,
  MAX_OVERVIEW_DAYS,
} from "../services/searchAnalytics.js";
import { isValidUtcCalendarDay } from "../validation/inputGuards.js";

export const analyticsRouter = Router();
analyticsRouter.use(requireAdmin);

/** Resumen agregado de `search_events` en los últimos N días (UTC). */
analyticsRouter.get("/search-overview", async (req, res) => {
  const parsed = z.coerce
    .number()
    .min(1)
    .max(MAX_OVERVIEW_DAYS)
    .safeParse(req.query.days ?? 7);
  const days = parsed.success ? parsed.data : 7;
  const db = await getDb();
  const overview = await getSearchOverview(db, days);
  res.json(overview);
});

const materializeBody = z
  .object({
    day: z.string().max(12),
  })
  .refine((b) => isValidUtcCalendarDay(b.day), {
    message: "Día inválido (use YYYY-MM-DD en calendario UTC).",
    path: ["day"],
  });

/**
 * Normaliza un día de eventos en un documento en `search_stats_daily` (reemplazo idempotente).
 */
analyticsRouter.post("/search-stats/materialize-day", async (req, res) => {
  const parsed = materializeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", details: parsed.error.flatten() });
    return;
  }
  const db = await getDb();
  const doc = await materializeSearchStatsForDay(db, parsed.data.day);
  res.json({ ok: true, doc });
});

/** Lista días ya materializados (más recientes primero). */
analyticsRouter.get("/search-stats/daily", async (req, res) => {
  const limitParsed = z.coerce.number().int().min(1).max(90).safeParse(req.query.limit ?? 30);
  const limit = limitParsed.success ? limitParsed.data : 30;
  const db = await getDb();
  const list = await db
    .collection(col.searchStatsDaily)
    .find({})
    .sort({ day: -1 })
    .limit(limit)
    .toArray();
  res.json({ items: list });
});
