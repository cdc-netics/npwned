import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable } from "rxjs";

/** Tipo de consulta admitida por la API pública. */
export type CheckKind = "email" | "rut" | "username" | "display_name";

/** Resumen de un incidente devuelto al usuario (sin datos sensibles). */
export interface BreachSummary {
  id: string;
  name: string;
  slug: string;
  incidentDate: string | null;
  description: string | null;
  /** Etiquetas del incidente (sector, contexto, etc.). */
  tags: string[];
}

/** Respuesta del endpoint `POST /api/public/check`. */
export interface CheckResponse {
  found: boolean;
  invalid?: boolean;
  breaches: BreachSummary[];
  /** Búsqueda de correo con comodines (`*`). */
  wildcard?: boolean;
  /** Coincidencias en el índice (filas escaneadas en el tramo devuelto). */
  matchCount?: number;
  /** Si hubo más coincidencias que el tope interno de la consulta. */
  matchCountTruncated?: boolean;
  /** Direcciones completas distintas en el tramo escaneado (búsqueda por comodín en correo). */
  emails?: string[];
  /** Correos cuyo usuario coincide con la búsqueda «Usuario» (mismo texto antes del @). */
  usernameEmailMatches?: string[];
  /** Si hubo más coincidencias por local de correo que el tope interno. */
  usernameEmailMatchesTruncated?: boolean;
  /** Valores distintos en índice para la búsqueda por nombre (misma lógica que el servidor). */
  displayNameMatches?: string[];
  displayNameMatchesTruncated?: boolean;
}

/**
 * Cliente HTTP para la comprobación pública (sin autenticación).
 */
@Injectable({ providedIn: "root" })
export class CheckApiService {
  constructor(private readonly http: HttpClient) {}

  /**
   * Consulta si un correo o RUT aparece en el índice de filtraciones.
   */
  check(kind: CheckKind, value: string): Observable<CheckResponse> {
    return this.http.post<CheckResponse>("/api/public/check", { kind, value });
  }
}
