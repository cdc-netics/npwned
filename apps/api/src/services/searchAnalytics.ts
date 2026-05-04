import type { Db } from "mongodb";
import { col } from "../db.js";
import { isValidUtcCalendarDay } from "../validation/inputGuards.js";

/** Límite superior de días para consultas de resumen (evita pipelines enormes). */
export const MAX_OVERVIEW_DAYS = 90;

export type SearchOverview = {
  from: string;
  to: string;
  days: number;
  total: number;
  hits: number;
  misses: number;
  invalid: number;
  byQueryType: Record<string, number>;
  topDomains: { domain: string; count: number }[];
};

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function addUtcDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function clampDays(days: number): number {
  if (Number.isNaN(days) || days < 1) return 7;
  return Math.min(Math.floor(days), MAX_OVERVIEW_DAYS);
}

/**
 * Resumen agregado de `search_events` en un rango [from, to) en UTC.
 * Sirve para paneles sin colección materializada (consulta al vuelo).
 */
export async function getSearchOverview(db: Db, days: number): Promise<SearchOverview> {
  const d = clampDays(days);
  const to = startOfUtcDay(new Date());
  const from = addUtcDays(to, -d);

  const [row] = await db
    .collection(col.searchEvents)
    .aggregate([
      { $match: { at: { $gte: from, $lt: addUtcDays(to, 1) } } },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                hits: { $sum: { $cond: [{ $eq: ["$hit", true] }, 1, 0] } },
                misses: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $eq: [{ $ifNull: ["$invalid", false] }, false] },
                          { $eq: ["$hit", false] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                invalid: {
                  $sum: { $cond: [{ $eq: [{ $ifNull: ["$invalid", false] }, true] }, 1, 0] },
                },
              },
            },
          ],
          byType: [{ $group: { _id: "$queryType", count: { $sum: 1 } } }],
          topDomains: [
            {
              $match: {
                domain: { $type: "string", $nin: ["", null] },
              },
            },
            { $group: { _id: "$domain", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 25 },
          ],
        },
      },
    ])
    .toArray();

  const facet = row as {
    totals: { total: number; hits: number; misses: number; invalid: number }[];
    byType: { _id: string; count: number }[];
    topDomains: { _id: string; count: number }[];
  };

  const t = facet?.totals?.[0] ?? { total: 0, hits: 0, misses: 0, invalid: 0 };
  const byQueryType: Record<string, number> = {};
  for (const x of facet?.byType ?? []) {
    if (x._id) byQueryType[String(x._id)] = x.count;
  }
  const topDomains = (facet?.topDomains ?? []).map((x) => ({
    domain: String(x._id),
    count: x.count,
  }));

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    days: d,
    total: t.total ?? 0,
    hits: t.hits ?? 0,
    misses: t.misses ?? 0,
    invalid: t.invalid ?? 0,
    byQueryType,
    topDomains,
  };
}

export type DailySearchStatsDoc = {
  day: string;
  generatedAt: Date;
  total: number;
  hits: number;
  misses: number;
  invalid: number;
  byQueryType: Record<string, number>;
  topDomains: { domain: string; count: number }[];
};

/**
 * Normaliza y guarda un día completo en `search_stats_daily` (UTC).
 * Idempotente: sustituye el documento del mismo `day`.
 */
export async function materializeSearchStatsForDay(db: Db, dayYyyyMmDd: string): Promise<DailySearchStatsDoc> {
  if (!isValidUtcCalendarDay(dayYyyyMmDd)) {
    throw new Error("day debe ser YYYY-MM-DD válido en calendario UTC");
  }
  const start = new Date(`${dayYyyyMmDd}T00:00:00.000Z`);
  const end = addUtcDays(start, 1);

  const [row] = await db
    .collection(col.searchEvents)
    .aggregate([
      { $match: { at: { $gte: start, $lt: end } } },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                hits: { $sum: { $cond: [{ $eq: ["$hit", true] }, 1, 0] } },
                misses: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          { $eq: [{ $ifNull: ["$invalid", false] }, false] },
                          { $eq: ["$hit", false] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                invalid: { $sum: { $cond: [{ $eq: [{ $ifNull: ["$invalid", false] }, true] }, 1, 0] } },
              },
            },
          ],
          byType: [{ $group: { _id: "$queryType", count: { $sum: 1 } } }],
          topDomains: [
            { $match: { domain: { $type: "string", $nin: ["", null] } } },
            { $group: { _id: "$domain", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 50 },
          ],
        },
      },
    ])
    .toArray();

  const facet = row as {
    totals: { total: number; hits: number; misses: number; invalid: number }[];
    byType: { _id: string; count: number }[];
    topDomains: { _id: string; count: number }[];
  };

  const t = facet?.totals?.[0] ?? { total: 0, hits: 0, misses: 0, invalid: 0 };
  const byQueryType: Record<string, number> = {};
  for (const x of facet?.byType ?? []) {
    if (x._id) byQueryType[String(x._id)] = x.count;
  }
  const topDomains = (facet?.topDomains ?? []).map((x) => ({
    domain: String(x._id),
    count: x.count,
  }));

  const doc: DailySearchStatsDoc = {
    day: dayYyyyMmDd,
    generatedAt: new Date(),
    total: t.total ?? 0,
    hits: t.hits ?? 0,
    misses: t.misses ?? 0,
    invalid: t.invalid ?? 0,
    byQueryType,
    topDomains,
  };

  await db.collection(col.searchStatsDaily).replaceOne({ day: dayYyyyMmDd }, doc, { upsert: true });
  return doc;
}
