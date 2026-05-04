import type { Db } from "mongodb";
import { col } from "./db.js";

/**
 * Crea índices idempotentes para consultas rápidas y restricciones de unicidad.
 * Conviene ejecutarlo en cada despliegue (es barato si los índices ya existen).
 */
export async function ensureIndexes(db: Db): Promise<void> {
  await db.collection(col.leakIndex).createIndexes([
    {
      key: { type: 1, value: 1, breachId: 1 },
      unique: true,
      name: "uniq_type_value_breach",
    },
    { key: { type: 1, value: 1 }, name: "lookup_type_value" },
  ]);

  await db.collection(col.breachSources).createIndexes([
    { key: { slug: 1 }, unique: true, name: "uniq_slug" },
    { key: { incidentDate: -1 }, name: "incidentDate_desc" },
  ]);

  await db.collection(col.admins).createIndexes([{ key: { username: 1 }, unique: true, name: "uniq_username" }]);

  await db.collection(col.searchEvents).createIndexes([
    { key: { at: -1 }, name: "at_desc" },
    { key: { queryType: 1, at: -1 }, name: "type_at" },
    { key: { domain: 1 }, name: "domain_sparse", sparse: true },
    { key: { breachSlugs: 1 }, name: "breach_slugs_sparse", sparse: true },
  ]);

  await db.collection(col.searchStatsDaily).createIndexes([
    { key: { day: 1 }, unique: true, name: "uniq_day" },
    { key: { generatedAt: -1 }, name: "generated_desc" },
  ]);

  await db.collection(col.identifierTypes).createIndexes([{ key: { key: 1 }, unique: true, name: "uniq_key" }]);

  await db.collection(col.ingestionProfiles).createIndexes([
    { key: { datasetSlug: 1 }, name: "dataset_slug" },
  ]);
}
