import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable } from "rxjs";

/** Respuesta del login de administrador. */
export interface AdminLoginResponse {
  token: string;
  expiresInHours: number;
}

/** Fila de incidente en el listado del panel. */
export interface BreachRow {
  id: string;
  name: string;
  slug: string;
  incidentDate: string | null;
  createdAt: string | null;
  tags: string[];
}

/** Cuenta de administrador (sin datos sensibles). */
export interface AdminUserRow {
  id: string;
  username: string;
  createdAt: string | null;
  createdBy: string | null;
}

/** Resumen agregado de eventos de búsqueda (`GET /analytics/search-overview`). */
export interface SearchOverview {
  from: string;
  to: string;
  days: number;
  total: number;
  hits: number;
  misses: number;
  invalid: number;
  byQueryType: Record<string, number>;
  topDomains: { domain: string; count: number }[];
}

/** Qué tipos intentar reconocer en cada celda (coincide con la API). */
export type IdentifierDetectMode = "email_rut" | "email_rut_plus_text";

type IngestProfileDetect = { detect?: IdentifierDetectMode };

/** Perfil de extracción (misma forma que envía la API de ingesta). */
export type IngestProfile =
  | ({ mode: "plain"; stripQuotes?: boolean } & IngestProfileDetect)
  | ({
      mode: "credential_pair";
      delimiter: "auto" | "tab" | "|" | ";" | ":";
      stripQuotes?: boolean;
    } & IngestProfileDetect)
  | ({
      mode: "csv";
      columnIndex: number;
      separator?: "," | ";" | "|";
      columnPick?: "fixed" | "auto_rut_email";
      stripQuotes?: boolean;
    } & IngestProfileDetect)
  | ({
      mode: "https_path_colons";
      identifierSegmentIndex: number;
      passwordSegmentIndex?: number;
      stripQuotes?: boolean;
    } & IngestProfileDetect)
  | ({
      mode: "regex_capture";
      pattern: string;
      flags?: string;
      captureGroupIndex?: number;
      stripQuotes?: boolean;
    } & IngestProfileDetect);

export interface IngestPreviewRow {
  lineNo: number;
  rawTruncated: string;
  status: "skip_line" | "no_cell" | "invalid_id" | "ok";
  extractedCell?: string;
  /** Cómo se obtuvo la celda desde la línea (perfil o heurística URL `/login`). */
  extractionMethod?: string;
  type?: "email" | "rut_cl" | "username" | "display_name";
  value?: string;
  /** Partición `https://host/ruta:a:b…` para elegir segmentos en la UI (no se persiste). */
  urlColonBaseUrl?: string;
  urlColonSegments?: string[];
  /** Segmento usado como candidato (resaltado en chips). */
  urlColonIdentifierSegmentIndex?: number;
}

export type TryNormalizeResponse =
  | { ok: true; type: "email" | "rut_cl" | "username" | "display_name"; value: string }
  | { ok: false };

export interface IngestPreviewResponse {
  stats: {
    linesSubmitted: number;
    ok: number;
    skipLine: number;
    noCell: number;
    invalidId: number;
  };
  rows: IngestPreviewRow[];
}

export interface IngestCommitResponse {
  ok: boolean;
  breachId: string;
  breachName: string;
  linesRead: number;
  linesSkipped: number;
  identifiersRecognized: number;
  upsertedNew: number;
  matchedExisting: number;
}

/** Respuesta de materializar un día en `search_stats_daily`. */
export interface MaterializeSearchDayResponse {
  ok: boolean;
  doc: {
    day: string;
    generatedAt: string;
    total: number;
    hits: number;
    misses: number;
    invalid: number;
    byQueryType: Record<string, number>;
    topDomains: { domain: string; count: number }[];
  };
}

/**
 * Cliente HTTP para endpoints `/api/admin` (el interceptor añade el JWT).
 */
@Injectable({ providedIn: "root" })
export class AdminApiService {
  constructor(private readonly http: HttpClient) {}

  /** Autentica y devuelve un JWT. */
  login(username: string, password: string): Observable<AdminLoginResponse> {
    return this.http.post<AdminLoginResponse>("/api/admin/login", {
      username,
      password,
    });
  }

  /** Lista incidentes registrados (requiere sesión admin). */
  listBreaches(): Observable<{ items: BreachRow[] }> {
    return this.http.get<{ items: BreachRow[] }>("/api/admin/breaches");
  }

  /** Crea un incidente vacío (luego indexas filas en `leak_index` contra su id). */
  createBreach(body: {
    name: string;
    slug: string;
    incidentDate?: string | null;
    description?: string | null;
    tags?: string[];
  }): Observable<{ id: string }> {
    return this.http.post<{ id: string }>("/api/admin/breaches", body);
  }

  /** Borra el incidente y todas las entradas de `leak_index` asociadas (`confirmDelete: true` tras confirmación en UI). */
  deleteBreachWithIndex(body: {
    breachId: string;
    confirmDelete: true;
  }): Observable<{
    ok: boolean;
    leakIndexDeletedCount: number;
    breachDeleted: boolean;
    slug: string;
  }> {
    return this.http.post<{
      ok: boolean;
      leakIndexDeletedCount: number;
      breachDeleted: boolean;
      slug: string;
    }>("/api/admin/breaches/delete-with-index", body);
  }

  /** Lista cuentas de administrador. */
  listUsers(): Observable<{ items: AdminUserRow[] }> {
    return this.http.get<{ items: AdminUserRow[] }>("/api/admin/users");
  }

  /** Crea otra cuenta de administrador (contraseña mín. 12 caracteres en API). */
  createUser(username: string, password: string): Observable<{ id: string }> {
    return this.http.post<{ id: string }>("/api/admin/users", {
      username,
      password,
    });
  }

  /** Agrega `search_events` en memoria para los últimos N días (máx. 90). */
  getSearchOverview(days = 7): Observable<SearchOverview> {
    return this.http.get<SearchOverview>(
      `/api/admin/analytics/search-overview?days=${days}`,
    );
  }

  /** Escribe un documento en `search_stats_daily` para el día UTC indicado (YYYY-MM-DD). */
  materializeSearchDay(day: string): Observable<MaterializeSearchDayResponse> {
    return this.http.post<MaterializeSearchDayResponse>(
      "/api/admin/analytics/search-stats/materialize-day",
      { day },
    );
  }

  /** Vista previa: analiza hasta 2500 líneas con el perfil indicado (sin escribir en Mongo). */
  previewIngest(lines: string[], profile: IngestProfile): Observable<IngestPreviewResponse> {
    return this.http.post<IngestPreviewResponse>("/api/admin/ingest/preview-lines", {
      lines,
      profile,
    });
  }

  /** Prueba un candidato con la misma normalización que la ingesta (según `detect` del perfil). */
  tryNormalizeCandidate(
    candidate: string,
    detect?: IdentifierDetectMode,
  ): Observable<TryNormalizeResponse> {
    return this.http.post<TryNormalizeResponse>("/api/admin/ingest/try-normalize", {
      candidate,
      detect,
    });
  }

  /** Indexa el archivo completo en `leak_index` para el incidente dado (multipart). */
  commitIngest(
    breachId: string,
    profile: IngestProfile,
    file: File,
  ): Observable<IngestCommitResponse> {
    const fd = new FormData();
    fd.append("breachId", breachId);
    fd.append("profile", JSON.stringify(profile));
    fd.append("file", file, file.name);
    return this.http.post<IngestCommitResponse>("/api/admin/ingest/commit", fd);
  }

  /** Elimina una entrada del índice (valor canónico como en la ingesta). */
  deleteLeakIndexEntry(body: {
    breachId: string;
    type: "email" | "rut_cl" | "username" | "display_name";
    value: string;
  }): Observable<{ ok: boolean; deletedCount: number }> {
    return this.http.post<{ ok: boolean; deletedCount: number }>(
      "/api/admin/leak-index/delete-entry",
      body,
    );
  }
}
