/**
 * Materializa estadísticas de búsqueda para un día UTC en `search_stats_daily`.
 * Uso: `npm run aggregate-search-stats -w @npwned/api` (ayer por defecto)
 *      o `npm run aggregate-search-stats -w @npwned/api -- 2026-05-02`
 */
import { closeDb, getDb } from "../db.js";
import { ensureIndexes } from "../indexes.js";
import { materializeSearchStatsForDay } from "../services/searchAnalytics.js";

function ayerUtcYyyyMmDd(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const day = process.argv[2] ?? ayerUtcYyyyMmDd();
  const db = await getDb();
  await ensureIndexes(db);
  const doc = await materializeSearchStatsForDay(db, day);
  // eslint-disable-next-line no-console -- salida del script
  console.log(JSON.stringify({ ok: true, day: doc.day, total: doc.total }, null, 2));
  await closeDb();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
