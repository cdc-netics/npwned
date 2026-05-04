import bcrypt from "bcryptjs";
import type { Db } from "mongodb";
import { col } from "./db.js";
import { config } from "./config.js";

/**
 * Si no existe ningún administrador, crea uno con `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
 * No modifica cuentas ya existentes.
 */
export async function seedAdminIfNeeded(db: Db): Promise<void> {
  const count = await db.collection(col.admins).countDocuments();
  if (count > 0) return;

  const passwordHash = await bcrypt.hash(config.adminPassword, 12);
  await db.collection(col.admins).insertOne({
    username: config.adminUsername,
    passwordHash,
    createdAt: new Date(),
  });
  // eslint-disable-next-line no-console -- aviso útil tras el primer arranque
  console.log(
    `Usuario administrador creado: "${config.adminUsername}". Cambia ADMIN_PASSWORD en producción.`,
  );
}
