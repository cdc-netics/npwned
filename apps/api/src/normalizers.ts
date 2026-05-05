/**
 * Normaliza un correo electrónico: sin espacios laterales y en minúsculas.
 * @returns Dirección canónica o `null` si el formato no es aceptable.
 */
export function normalizeEmail(input: string): string | null {
  const v = input.trim().toLowerCase();
  if (!v || !v.includes("@") || v.length > 320) return null;
  const lastAt = v.lastIndexOf("@");
  if (lastAt <= 0 || lastAt === v.length - 1) return null;
  const local = v.slice(0, lastAt);
  const domain = v.slice(lastAt + 1);
  if (!local || !domain || domain.length < 2) return null;
  return `${local}@${domain}`;
}

/**
 * Extrae el dominio (parte tras `@`) de un correo ya normalizado.
 */
export function emailDomain(email: string): string | null {
  const i = email.lastIndexOf("@");
  if (i <= 0 || i === email.length - 1) return null;
  return email.slice(i + 1).toLowerCase();
}

/**
 * Partes local/dominio que no pueden ser un correo real de fuga (evita marcar «OK» líneas URL enteras).
 * La consulta pública exacta sigue usando `normalizeEmail` sin este filtro extra.
 */
function emailPartsInvalidForLeakIngest(local: string, domain: string): boolean {
  if (local.includes("@")) return true;
  if (/[\s/<>\[\]()\\?#]/.test(local)) return true;
  if (/:/.test(local)) return true;
  if (domain.includes("@")) return true;
  if (/[\s/<>\[\]()\\?#]/.test(domain)) return true;
  if (/:/.test(domain)) return true;
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) return true;
  if (domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return true;
  return false;
}

/**
 * Correo para listas de fugas: exige un punto en el dominio para evitar falsos positivos
 * (p. ej. `s@pm2023` con «dominio» corto sin TLD) y rechaza basura tipo URL pegada al local o puerto al dominio.
 * La consulta pública (`/check`) sigue usando `normalizeEmail` permisivo para coincidencias exactas.
 */
export function normalizeEmailForLeakLine(input: string): string | null {
  const v = normalizeEmail(input);
  if (!v) return null;
  const i = v.lastIndexOf("@");
  const local = v.slice(0, i);
  const dom = v.slice(i + 1);
  if (!dom.includes(".")) return null;
  if (emailPartsInvalidForLeakIngest(local, dom)) return null;
  return v;
}

/** Máximo de asteriscos permitidos en un patrón de correo con comodines (API pública). */
export const EMAIL_WILDCARD_MAX_STARS = 12;

function escapeRegexFragment(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Patrón de correo con `*` → `RegExp` anclado sobre valores ya en minúsculas (índice).
 * Ej.: `*@pjud.cl` coincide con cualquier local en ese dominio.
 * Requiere `@` y dominio (tras el último `@`) con al menos un punto al quitar `*`.
 */
export function emailWildcardToRegExp(input: string): RegExp | null {
  const v = input.trim().toLowerCase();
  if (!v.includes("*")) return null;
  if (!v.includes("@")) return null;
  if (v.length > 300) return null;
  const stars = v.match(/\*/g)?.length ?? 0;
  if (stars === 0 || stars > EMAIL_WILDCARD_MAX_STARS) return null;
  const lastAt = v.lastIndexOf("@");
  if (lastAt <= 0 || lastAt === v.length - 1) return null;
  const domSide = v.slice(lastAt + 1);
  const domLiteral = domSide.replace(/\*/g, "");
  if (domLiteral.length < 2 || !domLiteral.includes(".")) return null;
  const parts = v.split("*").map((frag) => escapeRegexFragment(frag));
  try {
    return new RegExp(`^${parts.join(".*")}$`);
  } catch {
    return null;
  }
}

/** Dominio literal aproximado para métricas (fragmento tras el último `@`, sin `*`). */
export function emailWildcardDomainHint(input: string): string | undefined {
  const v = input.trim().toLowerCase();
  const lastAt = v.lastIndexOf("@");
  if (lastAt < 0) return undefined;
  const d = v.slice(lastAt + 1).replace(/\*/g, "");
  return d.includes(".") ? d : undefined;
}

/**
 * Dígito verificador (DV) módulo 11 del RUN/RUT chileno: multiplicadores 2–7 cíclicos de derecha a
 * izquierda sobre el cuerpo numérico; el resultado se mapea a 0–9 o K (procedimiento de dominio
 * público, usado por el SII y el Registro Civil). Resumen:
 * [Rol Único Tributario (Wikipedia)](https://es.wikipedia.org/wiki/Rol_%C3%9Anico_Tributario) ·
 * [SII — RUN e identificación](https://www.sii.cl/servicios_online/1047-.html).
 */
function rutVerifierDigit(body: string): string {
  let sum = 0;
  let mult = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i]!, 10) * mult;
    mult = mult === 7 ? 2 : mult + 1;
  }
  const rem = sum % 11;
  const d = 11 - rem;
  if (d === 11) return "0";
  if (d === 10) return "K";
  return String(d);
}

function rutCanonicalFromBodyDigits(body: string): string | null {
  if (!/^\d{6,8}$/.test(body)) return null;
  return `${body}${rutVerifierDigit(body)}`;
}

/** DV permitido: dígito o K latina; acepta homoglifos (p. ej. К cirílica, kelvin K) tras NFKC/mayúsculas. */
function normalizeRutDvChar(dv: string): string | null {
  const ch = dv.normalize("NFKC").trim().charAt(0);
  if (!ch) return null;
  if (/^[0-9]$/.test(ch)) return ch;
  const u = ch.toUpperCase();
  if (u === "K" || u === "\u041A" || u === "\u212A" || u === "\uFF2B") return "K";
  return null;
}

function rutTryBodyAndDv(body: string, dv: string): string | null {
  const d = normalizeRutDvChar(dv);
  if (!d || !/^\d{6,8}$/.test(body)) return null;
  return rutVerifierDigit(body) === d ? `${body}${d}` : null;
}

/** Guiones Unicode y similares → ASCII `-` (copiar/pegar desde PDF o Word). */
function normalizeRutSeparators(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-");
}

/**
 * Normaliza un RUN/RUT chileno (mismo algoritmo de DV en listados y formularios).
 *
 * - Cuerpo de **6 a 8** dígitos; DV es un dígito o **K**.
 * - Acepta puntos, espacios y un guion antes del DV (`12.345.678-5`, `12345678-K`).
 * - Sin guion: el último carácter es el DV (`123456785`, `12345678K`).
 * - **Solo cuerpo** (6–8 dígitos, sin DV en el texto): se calcula el DV.
 * - **8 dígitos sin guion** con DV erróneo: si no cuadra como «7 dígitos + DV», se intenta **cuerpo de
 *   8 dígitos** sin DV en la fuente (fugas truncadas o DV mal copiado).
 */
export function normalizeRutCl(input: string): string | null {
  const raw = normalizeRutSeparators(input)
    .trim()
    .normalize("NFKC")
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/\s/g, "");
  if (!raw) return null;

  if (raw.includes("-")) {
    /** El DV va tras el último guion (cuerpo puede venir con guiones erróneos, p. ej. `20-359967-6`). */
    const idx = raw.lastIndexOf("-");
    const head = raw.slice(0, idx).replace(/\D/g, "");
    const tail = raw.slice(idx + 1).trim();
    if (!head) return null;
    if (!tail) return rutCanonicalFromBodyDigits(head);
    const dv = tail[0]!;
    if (!normalizeRutDvChar(dv)) return null;
    const verified = rutTryBodyAndDv(head, dv);
    if (verified) return verified;
    /**
     * Fugas y capturas con DV mal copiado: si el cuerpo es válido, se canonifica con el DV
     * calculado (misma persona que en índice si se ingirió ya corregido).
     */
    if (/^\d{6,8}$/.test(head)) return rutCanonicalFromBodyDigits(head);
    return null;
  }

  /** Nueve dígitos seguidos sin guion: p. ej. `272327586` → cuerpo 8 + DV (último dígito). */
  if (/^\d{9}$/.test(raw)) {
    const body8 = raw.slice(0, 8);
    const dv9 = raw.slice(8, 9)!;
    const ok9 = rutTryBodyAndDv(body8, dv9);
    if (ok9) return ok9;
    if (rutCanonicalFromBodyDigits(body8)) return rutCanonicalFromBodyDigits(body8);
    return null;
  }

  const withDv = raw.match(/^(\d{6,8})(.)$/);
  if (withDv) {
    const body = withDv[1]!;
    const dv = withDv[2]!;
    if (normalizeRutDvChar(dv)) {
      const ok = rutTryBodyAndDv(body, dv);
      if (ok) return ok;
    }
    if (/^\d{8}$/.test(raw)) return rutCanonicalFromBodyDigits(raw);
    if (/^\d{7}$/.test(raw)) return rutCanonicalFromBodyDigits(raw);
    if (/^\d{6}$/.test(raw)) return rutCanonicalFromBodyDigits(raw);
    return null;
  }

  if (/^\d{6,8}$/.test(raw)) return rutCanonicalFromBodyDigits(raw);

  return null;
}

/**
 * Enmascara un correo ya en minúsculas para listados públicos (comodín), sin revelar el local completo.
 */
export function maskEmailForPublicDisplay(email: string): string {
  const v = email.trim().toLowerCase();
  const at = v.lastIndexOf("@");
  if (at <= 0 || at === v.length - 1) return "*@*";
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  if (!domain) return "*@*";
  if (local.length <= 1) return `*@${domain}`;
  return `${local[0]}***@${domain}`;
}

/**
 * Usuario / nick **sin espacios** (foros, juegos, login genérico). NFKC, minúsculas para
 * deduplicar; no sustituye a correo ni RUT (deben filtrarse antes).
 */
export function normalizeLeakUsername(input: string): string | null {
  const v = input.normalize("NFKC").trim().toLocaleLowerCase("und");
  if (v.length < 2 || v.length > 64) return null;
  if (/\s|@/.test(v)) return null;
  if (normalizeEmailForLeakLine(input.trim())) return null;
  if (normalizeRutCl(v)) return null;
  if (!/^[\p{L}\p{N}._-]+$/u.test(v)) return null;
  return v;
}

/**
 * Nombre propio o apodo (p. ej. «Juan Pérez», «García, Luis» o una sola palabra como «Jose»).
 * Conserva mayúsculas/minúsculas para coincidir con la fuga; solo normaliza Unicode y espacios.
 * No admite guion bajo ni puntuación de «nick»; eso queda para `normalizeLeakUsername`.
 */
export function normalizeLeakDisplayName(input: string): string | null {
  const v = input.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (v.length < 2 || v.length > 200) return null;
  if (/^\d+$/.test(v)) return null;
  // Evita tratar dominios/hosts (foo.bar.tld) como "nombre".
  if (v.includes(".") && !/\s|,/.test(v) && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)) return null;
  if (!/\p{L}/u.test(v)) return null;
  if (normalizeEmailForLeakLine(v)) return null;
  const rutish = v.replace(/\./g, "").replace(/\s/g, "");
  if (normalizeRutCl(rutish) || normalizeRutCl(v)) return null;
  if (/[\u0000-\u001F\u007F]/.test(v)) return null;
  if (!/^[\p{L}\p{M}0-9\s'’.,"()/-]+$/u.test(v)) return null;
  return v;
}

/**
 * ID alfanumérico "interno" (sistemas/empresas): exige letras y números para evitar ruido de nombres.
 * Conserva solo [A-Z0-9], quitando separadores comunes.
 */
export function normalizeInternalSystemId(input: string): string | null {
  const compact = input
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s._:/\\-]+/g, "")
    .trim();
  if (compact.length < 5 || compact.length > 40) return null;
  if (!/^[A-Z0-9]+$/.test(compact)) return null;
  if (!/[A-Z]/.test(compact) || !/[0-9]/.test(compact)) return null;
  if (normalizeRutCl(compact)) return null;
  if (normalizeEmailForLeakLine(compact)) return null;
  return compact;
}

/**
 * ID personal extranjero / nacional no-RUT:
 * - 6..16 dígitos, opcional prefijo de letras (1..4) o sufijo alfanumérico corto.
 * - Admite separadores visuales (`.`, `-`, espacio, `/`) y los canoniza.
 */
export function normalizeForeignOrGenericNationalId(input: string): string | null {
  const raw = input.normalize("NFKC").toUpperCase().trim();
  if (!raw) return null;
  if (normalizeRutCl(raw)) return null;

  const compact = raw.replace(/[.\-_\s/]+/g, "");
  if (compact.length < 6 || compact.length > 24) return null;
  if (!/^[A-Z0-9]+$/.test(compact)) return null;

  // Caso muy común: solo dígitos (DNI/CC/CI/etc.).
  if (/^\d{6,16}$/.test(compact)) return compact;

  // Prefijo letras + bloque numérico largo (ej. AEPA640422EC2, OHLM02284325).
  if (/^[A-Z]{1,6}\d{5,16}[A-Z0-9]{0,6}$/.test(compact)) return compact;

  // Número largo con sufijo alfanumérico corto.
  if (/^\d{6,16}[A-Z][A-Z0-9]{0,5}$/.test(compact)) return compact;

  return null;
}
