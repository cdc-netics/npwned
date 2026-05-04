/**
 * Ingesta masiva línea a línea: un solo paso por flujo (memoria acotada por lotes a Mongo).
 */
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { AnyBulkWriteOperation, Db } from "mongodb";
import { ObjectId } from "mongodb";
import { col } from "../db.js";
import { extractIdentifierFromLeakLine, type LeakLineExtractionMode } from "../ingestion/extractIdentifierFromLeakLine.js";

export type IngestRunStats = {
  linesRead: number;
  linesSkipped: number;
  identifiersRecognized: number;
  upsertedNew: number;
  matchedExisting: number;
};

const DEFAULT_BATCH = 2000;

/**
 * Lee texto UTF-8 línea a línea desde un `Readable` y hace upserts en `leak_index`.
 * No materializa el archivo entero en RAM: solo un lote de operaciones pendiente.
 */
export async function ingestLinesFromReadable(
  db: Db,
  breachId: ObjectId,
  profile: LeakLineExtractionMode,
  input: Readable,
  options?: { batchSize?: number },
): Promise<IngestRunStats> {
  const batchSize = options?.batchSize ?? DEFAULT_BATCH;
  let linesRead = 0;
  let linesSkipped = 0;
  let identifiersRecognized = 0;
  let upsertedNew = 0;
  let matchedExisting = 0;

  const batch: AnyBulkWriteOperation[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const r = await db.collection(col.leakIndex).bulkWrite(batch, { ordered: false });
    upsertedNew += r.upsertedCount;
    matchedExisting += r.matchedCount;
    batch.length = 0;
  };

  const rl = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      linesRead++;
      const n = extractIdentifierFromLeakLine(line, profile);
      if (!n) {
        linesSkipped++;
        continue;
      }
      identifiersRecognized++;
      batch.push({
        updateOne: {
          filter: { type: n.type, value: n.value, breachId },
          update: {
            $setOnInsert: {
              type: n.type,
              value: n.value,
              breachId,
              createdAt: new Date(),
            },
          },
          upsert: true,
        },
      });
      if (batch.length >= batchSize) {
        await flush();
      }
    }
    await flush();
  } finally {
    rl.close();
  }

  return {
    linesRead,
    linesSkipped,
    identifiersRecognized,
    upsertedNew,
    matchedExisting,
  };
}
