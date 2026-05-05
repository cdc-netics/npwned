/**
 * Extrae y normaliza identificadores desde líneas crudas de fugas (correo, RUT CL y, opcionalmente,
 * usuario o nombre para mostrar).
 *
 * Regla de oro: **nunca** persistir contraseñas ni el campo derecho de pares user:pass;
 * solo se usa la celda/campo elegido y se pasa por los normalizadores según `detect`.
 */
import {
  normalizeEmailForLeakLine,
  normalizeForeignOrGenericNationalId,
  normalizeLeakDisplayName,
  normalizeInternalSystemId,
  normalizeLeakUsername,
  normalizeRutCl,
} from "../normalizers.js";

export type CredentialDelimiter = "auto" | "tab" | "|" | ";" | ":";

/**
 * Qué tipos reconocer en la celda extraída.
 * - `email_rut`: solo correo (estricto) y RUT (comportamiento por defecto).
 * - `email_rut_plus_text`: además usuario sin espacios y nombre/apodo con espacio o coma.
 */
export type IdentifierDetectMode = "email_rut" | "email_rut_plus_text";

type ProfileDetect = { detect?: IdentifierDetectMode };

/** Resultado de partir `https://host/ruta:campo1:campo2…` (clave u otros listados con «:» tras la ruta). */
export type HttpsColonPathSplit = {
  /** `https://host` + ruta hasta el primer «:» del path+tail (sin campos posteriores). */
  baseUrl: string;
  /**
   * Trozos separados por «:» desde el primer «/» tras el host.
   * `[0]` = ruta (empieza por `/`), `[1]`… = campos sucesivos (p. ej. usuario, contraseña).
   */
  segments: string[];
};

/**
 * Si la línea es `https?://host/path:seg1:seg2…`, devuelve la URL base y los segmentos.
 * No interpreta puerto en host salvo el capturado por el regex estándar (`https://host:443/...` OK).
 */
export function splitHttpsUrlColonPath(raw: string): HttpsColonPathSplit | null {
  const t = stripLeadingBom(raw).replace(/\r$/, "").trim();
  const m = t.match(/^(https?:\/\/[^/]+)(\/?[^#]*)$/i);
  if (!m) return null;
  const baseHost = m[1]!;
  let pathAndTail = m[2] ?? "";
  if (pathAndTail === "") pathAndTail = "/";
  const parts = pathAndTail.split(":");
  if (parts.length === 0) return null;
  const pathOnly = parts[0] ?? "";
  const baseUrl = `${baseHost}${pathOnly}`;
  return { baseUrl, segments: parts.map((p) => p.trim()) };
}

/** Cómo interpretar una línea de archivo antes de normalizar. */
export type LeakLineExtractionMode =
  | ({ mode: "plain"; stripQuotes?: boolean } & ProfileDetect)
  | ({
      mode: "credential_pair";
      /** `auto`: primer separador presente en orden tab → | → ; → : (solo la primera aparición). */
      delimiter: CredentialDelimiter;
      stripQuotes?: boolean;
    } & ProfileDetect)
  | ({
      mode: "csv";
      /** Índice 0-based de la columna que contiene el identificador (si `columnPick` es `fixed` o omitido). */
      columnIndex: number;
      separator?: "," | ";" | "|";
      /**
       * `auto_rut_email`: primera celda con RUT en forma típica de exportación (evita totalizadores de 6 dígitos)
       * o correo; si no hay, sin celda útil.
       */
      columnPick?: "fixed" | "auto_rut_email";
      stripQuotes?: boolean;
    } & ProfileDetect)
  | ({
      mode: "https_path_colons";
      /**
       * Índice en `splitHttpsUrlColonPath(...).segments` cuyo texto se normaliza como id.
       * Suele ser `1` (tras la ruta) para `…/ruta:232772775:clave`.
       */
      identifierSegmentIndex: number;
      /**
       * Índice del segmento que actúa como contraseña (solo metadatos / UI; **nunca** se indexa).
       */
      passwordSegmentIndex?: number;
      stripQuotes?: boolean;
    } & ProfileDetect)
  | ({
      mode: "regex_capture";
      /** Patrón ECMAScript; debe incluir al menos un grupo `(...)` cuyo texto se normaliza como id. */
      pattern: string;
      /** Solo `i`, `m`, `s`, `u` (sin `g`: se evalúa línea a línea). */
      flags?: string;
      /** `0` = coincidencia completa; `1`… = grupo de captura. */
      captureGroupIndex?: number;
      stripQuotes?: boolean;
    } & ProfileDetect);

const CREDENTIAL_AUTO_ORDER = ["\t", "|", ";", ":"] as const;

export type NormalizedIdentifier = {
  type: "email" | "rut_cl" | "username" | "display_name" | "national_id" | "internal_id";
  value: string;
  sourceDomain?: string;
};

export function identifierDetectMode(profile: LeakLineExtractionMode): IdentifierDetectMode {
  return profile.detect ?? "email_rut";
}

/** Quita BOM UTF-8 al inicio de archivo si la primera línea lo trae pegado. */
export function stripLeadingBom(s: string): string {
  return s.length > 0 && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function sourceDomainFromRawLine(raw: string): string | undefined {
  const t = stripLeadingBom(raw).replace(/\r$/, "").trim();
  const m = t.match(/^https?:\/\/([^/:?#\s]+)(?::\d+)?(?:[/?#]|$)/i);
  if (!m) return undefined;
  const host = (m[1] ?? "").trim().toLowerCase();
  if (!host || host.length > 255) return undefined;
  return host;
}

/** Pies de listado «Total de registros: 42» que el combo con «:» confundía con nombre válido. */
function isExportFooterCountLine(trimmed: string): boolean {
  const s = trimmed.trim();
  if (/^\s*total\s+de\s+registros\s*:\s*\d{1,12}\s*$/i.test(s)) return true;
  if (/^\s*total\s+registros\s*:\s*\d{1,12}\s*$/i.test(s)) return true;
  if (/^\s*n[úu]mero\s+de\s+registros\s*:\s*\d{1,12}\s*$/i.test(s)) return true;
  if (/^\s*cantidad\s*(?:de\s+)?registros\s*:\s*\d{1,12}\s*$/i.test(s)) return true;
  if (/^\s*registros\s*(?:exportados|procesados|totales)?\s*:\s*\d{1,12}\s*$/i.test(s)) return true;
  if (/^\s*total\s+(?:rows|records)\s*:\s*\d{1,12}\s*$/i.test(s)) return true;
  if (/^\s*records\s*:\s*\d{1,12}\s*$/i.test(s)) return true;
  if (/^\s*count\s*:\s*\d{1,12}\s*$/i.test(s)) return true;
  if (/^\s*filas?\s*:\s*\d{1,12}\s*$/i.test(s)) return true;
  if (/^\s*l[ií]neas?\s*:\s*\d{1,12}\s*$/i.test(s)) return true;
  return false;
}

/**
 * `etiqueta: 123` donde la derecha es solo un entero y la izquierda parece resumen (no credencial).
 * Evita que «Total de registros: 19» pase por combo automático con el primer `:`.
 */
function isLabelColonBareIntegerSummary(left: string, right: string): boolean {
  const r = right.trim();
  if (!/^\d{1,12}$/.test(r)) return false;
  const L = left.trim().toLowerCase();
  if (L.includes("total") && (L.includes("registro") || L.includes("record") || L.includes("row")))
    return true;
  if (L.includes("cantidad") && L.includes("registro")) return true;
  if (/^n[úu]mero\s+de\s+registros$/.test(L)) return true;
  if (/^(total|count|filas|l[ií]neas|lineas)$/.test(L)) return true;
  return false;
}

/** Líneas vacías o comentarios típicos (export SQL, listas). */
export function isSkippableLeakLine(line: string): boolean {
  const t = stripLeadingBom(line).replace(/\r$/, "").trim();
  if (!t) return true;
  const lower = t.toLowerCase();
  if (lower.startsWith("#") || lower.startsWith("--")) return true;
  if (lower.startsWith("insert ") || lower.startsWith("create ")) return true;
  /** Separadores visuales `===`, `---`, tablas con solo guiones y pipes, etc. */
  if (/^[-=|_.\s‧•·…┈┉╌─━]{3,}$/u.test(t)) return true;
  if (isExportFooterCountLine(t)) return true;
  /**
   * Cabeceras tipo `Código Servicio | Totalizador | Rut Cliente | …` sin ningún dígito
   * (las filas de datos suelen traer RUT, teléfono o códigos con números).
   */
  if (t.includes("|") && !/\d/.test(t)) {
    const cols = t.split("|").filter((c) => c.trim().length > 0);
    /** ≥3 columnas sin ningún dígito: suele ser cabecera tipo export; evita filas de 2 textos sueltas. */
    if (cols.length >= 3) return true;
  }
  return false;
}

function stripOuterQuotes(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/""/g, '"');
  }
  return t;
}

function applyStripQuotes(s: string, stripQuotes: boolean | undefined): string {
  if (stripQuotes === false) return s.trim();
  return stripOuterQuotes(s).trim();
}

/**
 * Correo incrustado en líneas tipo `https://host:usuario@dominio.tld:clave` (sin `/` tras el host o el
 * parser por «:» en ruta no aplica). Evita tomar la URL entera como «correo» en modo plano.
 */
function extractEmailEmbeddedInUrlishLine(raw: string): string | null {
  if (!raw.includes("://") || !raw.includes("@")) return null;
  const re = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}/gi;
  const hits = raw.match(re);
  if (!hits?.length) return null;
  let best: string | null = null;
  for (const cand of hits) {
    const n = normalizeEmailForLeakLine(cand);
    if (n && (!best || n.length > best.length)) best = n;
  }
  return best;
}

function isLikelyUrlJunkSegment(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (/^\(?https?:\/\//i.test(t)) return true;
  if (/^\/\//.test(t)) return true;
  if (/^[/.]+$/.test(t)) return true;
  if (/\.(php|aspx?|jspx?|html?)$/i.test(t)) return true;
  if (/^(index|login|signin|registro|register|checkout|action|page)([._-]|$)/i.test(t)) return true;
  if (/^(single|input|bugfix|buscar|rut|usuario)$/i.test(t)) return true;
  if (t.includes("UUID_SEPARATOR") || t.includes("AUTH_SEPARATOR") || t.includes("DID_SEPARATOR")) return true;
  return false;
}

function looksPasswordLikeToken(s: string): boolean {
  const t = s.trim();
  if (t.length < 6) return false;
  if (/\s/.test(t)) return false;
  const hasLetter = /[a-z]/i.test(t);
  const hasDigit = /\d/.test(t);
  const hasSpecial = /[^a-z0-9._-]/i.test(t);
  if (hasLetter && hasDigit && hasSpecial) return true;
  if (/[!?$%&*#@^]/.test(t) && t.length >= 8) return true;
  return false;
}

function chooseBestUrlColonCandidate(
  segments: string[],
  detect: IdentifierDetectMode,
  stripQuotes: boolean | undefined,
): { segment: string | null; segmentIndex?: number; reason?: string } {
  let best: { idx: number; seg: string; score: number; reason: string } | null = null;
  for (let i = 1; i < segments.length; i++) {
    const seg = applyStripQuotes(segments[i] ?? "", stripQuotes);
    if (!seg || isLikelyUrlJunkSegment(seg)) continue;
    const n = normalizeUnknownIdentifier(seg, detect);
    if (!n) continue;
    let score = 10;
    if (n.type === "email") score += 60;
    else if (n.type === "rut_cl") score += 55;
    else if (n.type === "national_id") score += 42;
    else if (n.type === "internal_id") score += 32;
    else if (n.type === "username") score += 28;
    else if (n.type === "display_name") score += 20;
    if (looksPasswordLikeToken(seg)) score -= 18;
    if (seg.length > 80) score -= 10;
    if (best === null || score > best.score) {
      best = { idx: i, seg, score, reason: `${n.type}` };
    }
  }
  if (!best) return { segment: null };
  return {
    segment: best.seg,
    segmentIndex: best.idx,
    reason: best.reason,
  };
}

function splitOnFirst(line: string, delim: string): [string, string] | null {
  const i = line.indexOf(delim);
  if (i === -1) return null;
  return [line.slice(0, i), line.slice(i + delim.length)];
}

export type CredentialExtractDetail = { left: string | null; extractionMethod: string };

/**
 * Parte izquierda de `usuarioSEPARADORresto` (contraseña u otros campos a la derecha).
 * Si la línea es una URL con `/login`, se toma el usuario del path (evita que «auto» parta por `:` de `https:`).
 */
export function extractCredentialLeftFieldDetailed(
  line: string,
  delimiter: CredentialDelimiter,
): CredentialExtractDetail {
  const raw = stripLeadingBom(line).replace(/\r$/, "");
  const hostLike = raw.match(/^[a-z0-9.-]+\.[a-z]{2,}:/i);
  if (hostLike) {
    const parts = raw.split(":");
    if (parts.length >= 3) {
      const candidate = parts[1]?.trim() ?? "";
      if (candidate) {
        return {
          left: candidate,
          extractionMethod:
            "Combo: patrón host:id:clave detectado; se usa el segundo campo como identificador.",
        };
      }
    }
  }
  if (delimiter === "auto") {
    for (const d of CREDENTIAL_AUTO_ORDER) {
      const p = splitOnFirst(raw, d);
      if (!p) continue;
      if (d === ":" && isLabelColonBareIntegerSummary(p[0]!, p[1]!)) {
        continue;
      }
      const label = d === "\t" ? "tab" : d;
      return {
        left: p[0]!,
        extractionMethod: `Combo automático: primer separador «${label}» (campo izquierdo).`,
      };
    }
    return { left: null, extractionMethod: "" };
  }
  const d = delimiter === "tab" ? "\t" : delimiter;
  const p = splitOnFirst(raw, d);
  if (p) {
    if (d === ":" && isLabelColonBareIntegerSummary(p[0]!, p[1]!)) {
      return {
        left: null,
        extractionMethod:
          "Combo: línea tipo «etiqueta: número» de resumen (p. ej. total de registros); no se indexa.",
      };
    }
    return {
      left: p[0]!,
      extractionMethod: `Combo: campo izquierdo del separador «${d === "\t" ? "tab" : d}».`,
    };
  }
  return { left: null, extractionMethod: "" };
}

/**
 * Parte izquierda de `usuarioSEPARADORresto` (contraseña u otros campos a la derecha).
 * Convención estándar en listas combo: un solo separador “fuerte” entre login y secret.
 */
export function extractCredentialLeftField(
  line: string,
  delimiter: CredentialDelimiter,
): string | null {
  return extractCredentialLeftFieldDetailed(line, delimiter).left;
}

/** Parser CSV mínimo (RFC4180 básico: comillas dobles y duplicadas). Soporta `|` para tablas exportadas. */
export function splitCsvLineFields(line: string, separator: "," | ";" | "|" = ","): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === separator) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/**
 * RUT en tablas exportadas: exige forma explícita (7–8 dígitos + guion + DV, 9 dígitos seguidos, o
 * `12.345.678-9`). Evita que un totalizador de 6 dígitos pase por `normalizeRutCl` (demasiado permisivo).
 */
function normalizeRutClTableExportShape(cell: string): string | null {
  const compact = cell.trim().replace(/\./g, "").replace(/\s/g, "");
  if (/^\d{7,8}-[\dkK]$/i.test(compact)) return normalizeRutCl(cell);
  if (/^\d{9}$/.test(compact)) return normalizeRutCl(cell);
  const spaced = cell.trim().replace(/\s/g, "");
  if (/^\d{1,2}\.\d{3}\.\d{3}-[\dkK]$/i.test(spaced)) return normalizeRutCl(cell);
  return null;
}

function pickCsvAutoRutOrEmailCell(
  fields: string[],
  stripQuotes: boolean | undefined,
): { cell: string; extractionMethod: string } | null {
  for (let i = 0; i < fields.length; i++) {
    const rawC = applyStripQuotes(fields[i] ?? "", stripQuotes);
    if (!rawC.trim()) continue;
    if (normalizeRutClTableExportShape(rawC)) {
      return {
        cell: rawC,
        extractionMethod: `Columna automática: índice ${i} (RUT con forma típica de exportación).`,
      };
    }
  }
  for (let i = 0; i < fields.length; i++) {
    const rawC = applyStripQuotes(fields[i] ?? "", stripQuotes);
    if (!rawC.trim()) continue;
    if (normalizeEmailForLeakLine(rawC)) {
      return {
        cell: rawC,
        extractionMethod: `Columna automática: índice ${i} (correo).`,
      };
    }
  }
  return null;
}

/** Tope de caracteres por línea en modo regex (mitiga patrones patológicos). */
const MAX_REGEX_LINE_CHARS = 120_000;

const regexCaptureCache = new Map<string, RegExp>();
const REGEX_CAPTURE_CACHE_CAP = 48;

/** Solo flags seguros para evaluar líneas ajenas (sin `g`). Exportado para validar el perfil en Zod. */
export function sanitizeRegexEngineFlags(flags: string | undefined): string {
  let out = "";
  for (const c of (flags ?? "").toLowerCase()) {
    if ("imsu".includes(c) && !out.includes(c)) out += c;
  }
  return out;
}

function getCompiledRegexCapture(pattern: string, flags: string): RegExp {
  const key = `${pattern}\0${flags}`;
  let re = regexCaptureCache.get(key);
  if (re) return re;
  re = new RegExp(pattern, flags);
  if (regexCaptureCache.size >= REGEX_CAPTURE_CACHE_CAP) {
    const first = regexCaptureCache.keys().next().value;
    if (first !== undefined) regexCaptureCache.delete(first);
  }
  regexCaptureCache.set(key, re);
  return re;
}

function extractRegexCaptureCell(
  raw: string,
  profile: Extract<LeakLineExtractionMode, { mode: "regex_capture" }>,
): ExtractCellResult {
  if (raw.length > MAX_REGEX_LINE_CHARS) {
    return {
      cell: null,
      extractionMethod: `Regex: línea demasiado larga (máx. ${MAX_REGEX_LINE_CHARS} caracteres).`,
    };
  }
  const flags = sanitizeRegexEngineFlags(profile.flags);
  let re: RegExp;
  try {
    re = getCompiledRegexCapture(profile.pattern, flags);
  } catch {
    return { cell: null, extractionMethod: "Regex: patrón no compilable en el motor actual." };
  }
  const gi = profile.captureGroupIndex ?? 1;
  let m: RegExpExecArray | null;
  try {
    m = re.exec(raw);
  } catch {
    return { cell: null, extractionMethod: "Regex: error al evaluar la línea." };
  }
  if (!m) {
    return { cell: null, extractionMethod: "Regex: sin coincidencia en esta línea." };
  }
  if (gi < 0 || gi >= m.length) {
    return {
      cell: null,
      extractionMethod: `Regex: el grupo ${gi} no existe (hay grupos 0…${m.length - 1}).`,
    };
  }
  const rawCell = m[gi] ?? "";
  const v = applyStripQuotes(rawCell, profile.stripQuotes);
  const patShort = profile.pattern.length > 80 ? `${profile.pattern.slice(0, 80)}…` : profile.pattern;
  return {
    cell: v || null,
    extractionMethod: `Regex: grupo ${gi} de /${patShort}/${flags ? flags : ""}.`,
  };
}

type ExtractCellResult = {
  cell: string | null;
  extractionMethod?: string;
  /** Trozo elegido en `https://host/ruta:a:b…` (índice en `splitHttpsUrlColonPath().segments`). */
  urlColonIdentifierSegmentIndex?: number;
};

function extractCellForProfile(line: string, profile: LeakLineExtractionMode): ExtractCellResult {
  if (isSkippableLeakLine(line)) return { cell: null };
  const raw = stripLeadingBom(line).replace(/\r$/, "");

  if (profile.mode === "regex_capture") {
    return extractRegexCaptureCell(raw, profile);
  }

  if (profile.mode === "plain") {
    const colonParsed = splitHttpsUrlColonPath(raw);
    if (colonParsed && colonParsed.segments.length >= 2) {
      const detect = identifierDetectMode(profile);
      const best = chooseBestUrlColonCandidate(colonParsed.segments, detect, profile.stripQuotes);
      if (best.segment && best.segmentIndex !== undefined) {
        return {
          cell: best.segment,
          extractionMethod: `Una celda (autom.): URL con campos «:» tras la ruta — trozo ${best.segmentIndex} priorizado (${best.reason}); base «${colonParsed.baseUrl}».`,
          urlColonIdentifierSegmentIndex: best.segmentIndex,
        };
      }
      const seg1 = applyStripQuotes(colonParsed.segments[1] ?? "", profile.stripQuotes);
      if (seg1 && !isLikelyUrlJunkSegment(seg1)) {
        return {
          cell: seg1,
          extractionMethod: `Una celda (autom.): URL con «:» tras la ruta — trozo 1 como candidato (no coincide aún con correo/RUT${detect === "email_rut_plus_text" ? "/usuario/nombre" : ""}); base «${colonParsed.baseUrl}».`,
          urlColonIdentifierSegmentIndex: 1,
        };
      }
      return {
        cell: null,
        extractionMethod:
          "Una celda (autom.): URL con «:» tras la ruta, pero sin segmento identificable (solo ruta/placeholders o texto ambiguo).",
      };
    }
    const embedded = extractEmailEmbeddedInUrlishLine(raw);
    if (embedded) {
      return {
        cell: embedded,
        extractionMethod:
          "Correo incrustado en una línea tipo URL (p. ej. host:usuario@dominio.tld:clave sin path claro); solo se indexa el correo detectado.",
      };
    }
    const v = applyStripQuotes(raw, profile.stripQuotes);
    return { cell: v || null, extractionMethod: "Toda la línea (modo plano)." };
  }

  if (profile.mode === "https_path_colons") {
    const parsed = splitHttpsUrlColonPath(raw);
    if (!parsed) {
      return {
        cell: null,
        extractionMethod:
          "Modo URL+«:»: la línea no coincide con https://host/ruta:campo1:campo2… (revisa https, la ruta y los dos puntos).",
      };
    }
    const idx = profile.identifierSegmentIndex;
    const seg = parsed.segments[idx];
    if (seg === undefined || seg === "") {
      return {
        cell: null,
        extractionMethod: `URL+«:»: no hay segmento en el índice ${idx} (${parsed.segments.length} segmentos).`,
      };
    }
    const v = applyStripQuotes(seg, profile.stripQuotes);
    const passPart =
      profile.passwordSegmentIndex !== undefined &&
      profile.passwordSegmentIndex !== null &&
      parsed.segments[profile.passwordSegmentIndex] !== undefined
        ? ` Contraseña en índice ${profile.passwordSegmentIndex} (no indexada).`
        : "";
    return {
      cell: v || null,
      extractionMethod: `URL+«:»: segmento índice ${idx} → candidato; página ≈ «${parsed.baseUrl}».${passPart}`,
      urlColonIdentifierSegmentIndex: idx,
    };
  }

  if (profile.mode === "credential_pair") {
    const pipeFields = raw.split("|");
    const looksLikeMultiColumnPipe =
      (profile.delimiter === "|" || profile.delimiter === "auto") && pipeFields.length >= 3;
    if (looksLikeMultiColumnPipe) {
      const picked = pickCsvAutoRutOrEmailCell(pipeFields, profile.stripQuotes);
      if (picked) {
        const detail = picked.extractionMethod.replace(/^Columna automática: /, "");
        return {
          cell: picked.cell,
          extractionMethod: `Tabla con «|» (${pipeFields.length} columnas): ${detail} — prioridad sobre «solo la primera celda» del combo.`,
        };
      }
    }
    const det = extractCredentialLeftFieldDetailed(raw, profile.delimiter);
    if (!det.left) return { cell: null, extractionMethod: det.extractionMethod };
    const v = applyStripQuotes(det.left, profile.stripQuotes);
    return { cell: v || null, extractionMethod: det.extractionMethod };
  }

  if (profile.mode === "csv") {
    const sep = profile.separator ?? ",";
    const fields = splitCsvLineFields(raw, sep);
    const pick = profile.columnPick ?? "fixed";
    if (pick === "auto_rut_email") {
      const picked = pickCsvAutoRutOrEmailCell(fields, profile.stripQuotes);
      if (picked) return { cell: picked.cell, extractionMethod: picked.extractionMethod };
      return {
        cell: null,
        extractionMethod: `Columna automática (separador «${sep}»): ninguna celda con RUT en forma explícita ni correo.`,
      };
    }
    const cell = fields[profile.columnIndex];
    if (cell === undefined) {
      return {
        cell: null,
        extractionMethod: `Columna índice ${profile.columnIndex} (separador «${sep}»).`,
      };
    }
    const v = applyStripQuotes(cell, profile.stripQuotes);
    return {
      cell: v || null,
      extractionMethod: `Columna índice ${profile.columnIndex} (separador «${sep}»).`,
    };
  }

  return { cell: null };
}

/**
 * Clasifica una celda ya extraída: correo, RUT y —si el perfil lo pide— usuario o nombre visible.
 */
export function normalizeUnknownIdentifier(
  candidate: string,
  detect: IdentifierDetectMode = "email_rut",
): NormalizedIdentifier | null {
  const candidateCompact = candidate
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[.\-_\s/]+/g, "")
    .trim();
  const explicitRutShape = /[.\-kK]/.test(candidate) || /^\d{6,8}[kK]$/.test(candidateCompact);
  const email = normalizeEmailForLeakLine(candidate);
  if (email) return { type: "email", value: email };
  if (
    detect === "email_rut_plus_text" &&
    !explicitRutShape &&
    /^\d{8,16}$/.test(candidateCompact)
  ) {
    return { type: "national_id", value: candidateCompact };
  }
  const rut = normalizeRutCl(candidate);
  if (rut) return { type: "rut_cl", value: rut };
  if (detect !== "email_rut_plus_text") return null;
  const nat = normalizeForeignOrGenericNationalId(candidate);
  if (nat) return { type: "national_id", value: nat };
  const internal = normalizeInternalSystemId(candidate);
  if (internal) return { type: "internal_id", value: internal };
  const display = normalizeLeakDisplayName(candidate);
  if (display) return { type: "display_name", value: display };
  const user = normalizeLeakUsername(candidate);
  if (user) return { type: "username", value: user };
  return null;
}

/**
 * De una línea de fuga y un perfil de extracción, obtiene tipo + valor canónico o `null`.
 */
export function extractIdentifierFromLeakLine(
  line: string,
  profile: LeakLineExtractionMode,
): NormalizedIdentifier | null {
  const { cell } = extractCellForProfile(line, profile);
  if (!cell) return null;
  const normalized = normalizeUnknownIdentifier(cell, identifierDetectMode(profile));
  if (!normalized) return null;
  const sourceDomain = sourceDomainFromRawLine(line);
  return sourceDomain ? { ...normalized, sourceDomain } : normalized;
}

/** Resultado de inspección línea a línea (vista previa humana antes de indexar). */
export type LeakLinePeekStatus = "skip_line" | "no_cell" | "invalid_id" | "ok";

export type LeakLinePeekRow = {
  lineNo: number;
  rawTruncated: string;
  status: LeakLinePeekStatus;
  /** Texto de la celda usada como candidato (correo/RUT), recortado para la tabla. */
  extractedCell?: string;
  /** Cómo se obtuvo la celda a partir de la línea (perfil / heurística URL). */
  extractionMethod?: string;
  type?: "email" | "rut_cl" | "username" | "display_name" | "national_id" | "internal_id";
  value?: string;
  /** Si la línea encaja en `https://host/ruta:a:b…`, ayuda a elegir segmentos en la UI (no se persiste). */
  urlColonBaseUrl?: string;
  urlColonSegments?: string[];
  /** Índice del segmento usado como celda candidata (modo plano autom. o perfil URL+«:»). */
  urlColonIdentifierSegmentIndex?: number;
};

/**
 * Explica qué ocurriría con una línea: ignorada, sin celda útil, celda no reconocida como id, u OK.
 */
export function peekLeakLineParse(
  line: string,
  lineNo: number,
  profile: LeakLineExtractionMode,
  rawMax = 360,
): LeakLinePeekRow {
  const rawTruncated =
    line.length > rawMax ? `${line.slice(0, rawMax)}…` : line.replace(/\r$/, "");
  if (isSkippableLeakLine(line)) {
    return { lineNo, rawTruncated, status: "skip_line" };
  }
  const { cell, extractionMethod, urlColonIdentifierSegmentIndex } = extractCellForProfile(
    line,
    profile,
  );
  const colonHint = splitHttpsUrlColonPath(line);
  const urlColonHint =
    colonHint && colonHint.segments.length >= 2
      ? {
          urlColonBaseUrl: colonHint.baseUrl,
          urlColonSegments: colonHint.segments,
          ...(urlColonIdentifierSegmentIndex !== undefined
            ? { urlColonIdentifierSegmentIndex }
            : {}),
        }
      : undefined;

  if (!cell) {
    return {
      lineNo,
      rawTruncated,
      status: "no_cell",
      extractionMethod: extractionMethod || undefined,
      ...urlColonHint,
    };
  }
  const showCell = cell.length > 160 ? `${cell.slice(0, 160)}…` : cell;
  const n = normalizeUnknownIdentifier(cell, identifierDetectMode(profile));
  if (!n) {
    return {
      lineNo,
      rawTruncated,
      status: "invalid_id",
      extractedCell: showCell,
      extractionMethod,
      ...urlColonHint,
    };
  }
  return {
    lineNo,
    rawTruncated,
    status: "ok",
    extractedCell: showCell,
    extractionMethod,
    type: n.type,
    value: n.value,
    ...urlColonHint,
  };
}
