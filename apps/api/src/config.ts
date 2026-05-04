import "dotenv/config";

/**
 * Obtiene una variable de entorno obligatoria.
 * @param name Nombre de la variable (p. ej. `MONGODB_URI`).
 * @param fallback Valor por defecto si no está definida (solo para desarrollo).
 * @throws Si no hay valor ni valor por defecto.
 */
function requerido(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Falta la variable de entorno: ${name}`);
  return v;
}

/** Configuración cargada desde el entorno (.env + variables del sistema). */
export const config = {
  /** Puerto HTTP de la API Express. */
  port: Number(process.env.PORT ?? 3000),
  /** URI de conexión a MongoDB. */
  mongoUri: requerido("MONGODB_URI", "mongodb://127.0.0.1:27017"),
  /** Nombre de la base de datos lógica dentro del clúster. */
  mongoDb: process.env.MONGODB_DB ?? "npwned",
  /** Secreto para firmar y verificar JWT de administradores. */
  jwtSecret: requerido("JWT_SECRET", "dev-only-change-me"),
  /** Usuario inicial del panel (se crea solo si la colección está vacía). */
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  /** Contraseña en texto plano solo para el primer arranque/seed; en producción usar valor fuerte. */
  adminPassword: process.env.ADMIN_PASSWORD ?? "admin",
  /** Orígenes permitidos para CORS (lista separada por comas). */
  corsOrigin: process.env.CORS_ORIGIN?.split(",").map((s) => s.trim()) ?? [
    "http://localhost:4200",
  ],
  /**
   * Tras proxy inverso (nginx, traefik): `true` para IP real y rate limit correctos.
   */
  trustProxy:
    process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true",
};
