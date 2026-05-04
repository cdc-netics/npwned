/**
 * Script CLI: índices, usuario admin si falta, catálogo de tipos y dataset demo.
 * Uso: `npm run seed` en el paquete `@npwned/api` (requiere MongoDB en marcha).
 */
import { closeDb, getDb } from "../db.js";
import { ensureIndexes } from "../indexes.js";
import { seedAdminIfNeeded } from "../seedAdmin.js";
import { seedDemoDataset, seedIdentifierCatalog } from "../seedDefaults.js";

async function main() {
  const db = await getDb();
  await ensureIndexes(db);
  await seedAdminIfNeeded(db);
  await seedIdentifierCatalog(db);
  await seedDemoDataset(db);
  // eslint-disable-next-line no-console -- salida del script
  console.log("Seed completado correctamente.");
  await closeDb();
}

main().catch((e) => {
  // eslint-disable-next-line no-console -- error del script
  console.error(e);
  process.exit(1);
});
