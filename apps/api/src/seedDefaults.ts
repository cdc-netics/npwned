import type { Db } from "mongodb";
import { col } from "./db.js";
import {
  normalizeEmail,
  normalizeLeakDisplayName,
  normalizeLeakUsername,
  normalizeRutCl,
} from "./normalizers.js";

/**
 * Asegura en base los tipos de identificador conocidos (correo, RUT Chile, usuario, nombre, etc.).
 * Idempotente: actualiza etiquetas y deja `key` estable.
 */
export async function seedIdentifierCatalog(db: Db): Promise<void> {
  const now = new Date();
  await db.collection(col.identifierTypes).bulkWrite([
    {
      updateOne: {
        filter: { key: "email" },
        update: {
          $set: {
            label: "Correo electrónico",
            normalizerId: "email",
            updatedAt: now,
          },
          $setOnInsert: { key: "email", createdAt: now },
        },
        upsert: true,
      },
    },
    {
      updateOne: {
        filter: { key: "rut_cl" },
        update: {
          $set: {
            label: "RUT (Chile)",
            normalizerId: "rut_cl",
            updatedAt: now,
          },
          $setOnInsert: { key: "rut_cl", createdAt: now },
        },
        upsert: true,
      },
    },
    {
      updateOne: {
        filter: { key: "username" },
        update: {
          $set: {
            label: "Usuario o nick (sin espacios)",
            normalizerId: "username",
            updatedAt: now,
          },
          $setOnInsert: { key: "username", createdAt: now },
        },
        upsert: true,
      },
    },
    {
      updateOne: {
        filter: { key: "display_name" },
        update: {
          $set: {
            label: "Nombre o apodo (con espacio o coma)",
            normalizerId: "display_name",
            updatedAt: now,
          },
          $setOnInsert: { key: "display_name", createdAt: now },
        },
        upsert: true,
      },
    },
  ]);
}

/**
 * Crea un incidente de demostración y filas de índice de ejemplo (solo desarrollo).
 * Idempotente: no duplica entradas en `leak_index` para la misma terna tipo/valor/breach.
 */
export async function seedDemoDataset(db: Db): Promise<void> {
  const slug = "npwned-demo";
  let breach = await db.collection(col.breachSources).findOne({ slug });
  if (!breach) {
    const r = await db.collection(col.breachSources).insertOne({
      name: "Demostración NPwned",
      slug,
      incidentDate: new Date("2020-01-01T00:00:00.000Z"),
      description: "Incidente de ejemplo para desarrollo local.",
      tags: ["demo", "desarrollo"],
      createdAt: new Date(),
    });
    breach = { _id: r.insertedId, slug };
  }

  const breachId = breach._id;

  await db.collection(col.breachSources).updateOne(
    { _id: breachId },
    { $set: { tags: ["demo", "desarrollo"] } },
  );

  const samples: { type: "email" | "rut_cl" | "username" | "display_name"; raw: string }[] = [
    { type: "email", raw: "demo@npwned.local" },
    { type: "rut_cl", raw: "12.345.678-5" },
    { type: "username", raw: "demo_user" },
    { type: "display_name", raw: "Usuario Demo" },
  ];

  for (const s of samples) {
    const value =
      s.type === "email"
        ? normalizeEmail(s.raw)
        : s.type === "rut_cl"
          ? normalizeRutCl(s.raw)
          : s.type === "username"
            ? normalizeLeakUsername(s.raw)
            : normalizeLeakDisplayName(s.raw);
    if (!value) continue;
    await db.collection(col.leakIndex).updateOne(
      { type: s.type, value, breachId },
      {
        $setOnInsert: {
          type: s.type,
          value,
          breachId,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
  }
}
