import { ObjectId } from "mongodb";

/** ObjectId hex de 24 caracteres (sin mezclar otros formatos en consultas). */
const OBJECT_ID_HEX = /^[a-f0-9]{24}$/i;

/**
 * Caracteres de control, DEL y overrides bidireccionales (abuso / confusión en UI y logs).
 * No sustituye a la validación de dominio (Zod, normalizadores).
 */
export function hasBinaryOrBidiGarbage(s: string): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000e-\u001f\u007F\u202E\u202D]/.test(s);
}

/** Intenta parsear un ObjectId desde hex 24; devuelve `null` si no es válido (nunca lanza). */
export function tryParseObjectIdHex(hex: string): ObjectId | null {
  const t = hex.trim();
  if (!OBJECT_ID_HEX.test(t)) return null;
  try {
    return new ObjectId(t);
  } catch {
    return null;
  }
}

/**
 * Extrae `ObjectId` únicos y válidos desde filas de `leak_index` (evita 500 si `breachId` está corrupto).
 */
export function uniqueBreachObjectIdsFromRows(rows: { breachId?: unknown }[]): ObjectId[] {
  const seen = new Set<string>();
  const out: ObjectId[] = [];
  for (const r of rows) {
    const s = String(r.breachId ?? "").trim();
    if (!OBJECT_ID_HEX.test(s) || seen.has(s)) continue;
    const oid = tryParseObjectIdHex(s);
    if (!oid) continue;
    seen.add(s);
    out.push(oid);
  }
  return out;
}

/**
 * `YYYY-MM-DD` que corresponde a un día civil real en UTC (evita fechas que `Date` “corrige”).
 */
export function isValidUtcCalendarDay(dayYyyyMmDd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayYyyyMmDd)) return false;
  const [y, m, d] = dayYyyyMmDd.split("-").map((x) => Number(x));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
