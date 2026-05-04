/**
 * Punto de entrada del servidor HTTP.
 * Arranca Express, asegura índices en MongoDB y datos mínimos de catálogo.
 */
import type { Server } from "http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import { closeDb, getDb } from "./db.js";
import { ensureIndexes } from "./indexes.js";
import { publicRouter } from "./routes/public.js";
import { adminRouter } from "./routes/admin.js";
import { ingestRouter } from "./routes/ingest.js";
import { seedAdminIfNeeded } from "./seedAdmin.js";
import { seedIdentifierCatalog } from "./seedDefaults.js";

const app = express();
if (config.trustProxy) {
  app.set("trust proxy", 1);
}
/** Cabeceras HTTP endurecidas (API JSON; CSP desactivada para no romper integraciones atípicas). */
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  }),
);
/**
 * Ingesta **antes** del `express.json` global (32 kb): la vista prevía envía JSON de varios MB;
 * si el JSON global va primero, Express responde 413 y nunca llega al parser de 16 MB del router.
 */
app.use("/api/admin/ingest", ingestRouter);
app.use(express.json({ limit: "32kb" }));

/** Rutas sin autenticación (consulta pública y salud). */
app.use("/api/public", publicRouter);
/** Rutas de administración (login + JWT en el resto de endpoints). */
app.use("/api/admin", adminRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "not_found" });
});

let server: Server | null = null;

/** Cierre ordenado: deja de aceptar HTTP y cierra Mongo (SIGTERM en Docker / orquestadores). */
async function shutdown(signal: string): Promise<void> {
  // eslint-disable-next-line no-console -- operación de operador
  console.log(`Señal ${signal}: cierre ordenado…`);
  if (server) {
    await new Promise<void>((resolve) => {
      server!.close(() => resolve());
    });
    server = null;
  }
  await closeDb();
  process.exit(0);
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

async function main() {
  const db = await getDb();
  await ensureIndexes(db);
  await seedAdminIfNeeded(db);
  await seedIdentifierCatalog(db);

  await new Promise<void>((resolve, reject) => {
    const s = app.listen(config.port, () => resolve());
    s.once("error", reject);
    server = s;
    /** Ingesta por streaming puede durar horas; 0 = sin timeout de inactividad en el socket. */
    s.timeout = 0;
    const httpSrv = s as import("http").Server & { requestTimeout?: number };
    if (typeof httpSrv.requestTimeout === "number") {
      httpSrv.requestTimeout = 0;
    }
  });

  // eslint-disable-next-line no-console -- mensaje de arranque intencional
  console.log(`API escuchando en http://localhost:${config.port}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console -- error fatal al iniciar
  console.error(e);
  process.exit(1);
});
