import { Injectable, signal } from "@angular/core";

/** Clave en `localStorage` para el JWT del panel de administración. */
const STORAGE_KEY = "npwned_admin_token";

/**
 * Estado de sesión del administrador (token JWT en memoria + almacenamiento local).
 */
@Injectable({ providedIn: "root" })
export class AuthService {
  /** Token actual o `null` si no hay sesión. */
  readonly token = signal<string | null>(null);

  constructor() {
    const t = localStorage.getItem(STORAGE_KEY);
    this.token.set(t);
  }

  /** Guarda el token y actualiza la señal reactiva. */
  setToken(token: string): void {
    localStorage.setItem(STORAGE_KEY, token);
    this.token.set(token);
  }

  /** Cierra sesión y borra el almacenamiento local. */
  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.token.set(null);
  }
}
