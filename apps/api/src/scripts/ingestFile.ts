/**
 * Ingesta masiva desde ruta de archivo (streaming). Pensado para listas enormes (millones de líneas)
 * sin pasar por el navegador: ejecutar dentro del contenedor `api` con un volumen montado.
 *
 * Uso (desde `apps/api`, con Mongo accesible vía env):
 *   npx tsx src/scripts/ingestFile.ts --breachId <ObjectId> --profile '{"mode":"credential_pair","delimiter":"auto"}' /ruta/archivo.txt
 *
 * Docker (ejemplo Windows; ajusta rutas):
 *   docker compose --env-file .env run --rm -v D:/leaks:/leaks:ro api node apps/api/dist/scripts/ingestFile.js --breachId=... --profile=... /leaks/grande.txt
 */
import { createReadStream } from "node:fs";
import { parseArgs } from "node:util";
import "dotenv/config";
import { ObjectId } from "mongodb";
import { closeDb, col, getDb } from "../db.js";
import { leakProfileSchema } from "../ingestion/ingestProfileZod.js";
import { ingestLinesFromReadable } from "../services/ingestBulk.js";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      breachId: { type: "string" },
      profile: { type: "string" },
    },
    allowPositionals: true,
  });

  const filePath = positionals[0];
  if (!filePath || !values.breachId || !values.profile) {
    // eslint-disable-next-line no-console -- CLI
    console.error(
      "Uso: ingestFile.ts --breachId <id> --profile '<json del perfil>' <ruta-archivo-utf8>",
    );
    process.exit(1);
  }

  let breachId: ObjectId;
  try {
    breachId = new ObjectId(values.breachId);
  } catch {
    // eslint-disable-next-line no-console -- CLI
    console.error("breachId no es un ObjectId válido.");
    process.exit(1);
  }

  let profileJson: unknown;
  try {
    profileJson = JSON.parse(values.profile) as unknown;
  } catch {
    // eslint-disable-next-line no-console -- CLI
    console.error("--profile debe ser JSON válido.");
    process.exit(1);
  }

  const parsed = leakProfileSchema.safeParse(profileJson);
  if (!parsed.success) {
    // eslint-disable-next-line no-console -- CLI
    console.error("Perfil inválido:", parsed.error.flatten());
    process.exit(1);
  }

  const db = await getDb();
  const breach = await db.collection(col.breachSources).findOne({ _id: breachId });
  if (!breach) {
    // eslint-disable-next-line no-console -- CLI
    console.error("No existe breach_sources con ese _id.");
    process.exit(1);
  }

  const rs = createReadStream(filePath, { encoding: "utf8" });
  const t0 = Date.now();
  const stats = await ingestLinesFromReadable(db, breachId, parsed.data, rs);
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  // eslint-disable-next-line no-console -- salida del script
  console.log(JSON.stringify({ ok: true, breach: breach.name, seconds: Number(sec), ...stats }, null, 2));
  await closeDb();
}

main().catch((e) => {
  // eslint-disable-next-line no-console -- error del script
  console.error(e);
  process.exit(1);
});
