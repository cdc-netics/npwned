import { MongoClient, Db } from "mongodb";
import { config } from "./config.js";

/** Opciones de cliente orientadas a entornos Docker / redes lentas al arrancar. */
const mongoClientOptions = {
  /** Espera a que el réplica set / standalone responda (arranque ordenado en Compose). */
  serverSelectionTimeoutMS: 90_000,
  connectTimeoutMS: 20_000,
  maxPoolSize: 32,
  minPoolSize: 0,
  retryWrites: true,
} as const;

/** Cliente singleton (conexión TCP al clúster). */
let client: MongoClient | null = null;
/** Referencia a la base de datos activa. */
let db: Db | null = null;

/**
 * Devuelve la instancia de base de datos, abriendo conexión si aún no existe.
 */
export async function getDb(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(config.mongoUri, mongoClientOptions);
  await client.connect();
  db = client.db(config.mongoDb);
  return db;
}

/** Cierra el cliente y limpia referencias (útil en apagado o tests). */
export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}

/** Nombres físicos de colecciones en MongoDB (única fuente de verdad). */
export const col = {
  breachSources: "breach_sources",
  leakIndex: "leak_index",
  admins: "admins",
  searchEvents: "search_events",
  /** Agregados diarios de búsquedas (materialización; ver `materializeSearchStatsForDay`). */
  searchStatsDaily: "search_stats_daily",
  identifierTypes: "identifier_types",
  ingestionProfiles: "ingestion_profiles",
} as const;
