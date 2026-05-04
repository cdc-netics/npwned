/**
 * Variables de entorno para desarrollo y pruebas locales.
 * En producción, `angular.json` reemplaza este archivo por `environment.prod.ts`.
 */
export const environment = {
  /** `true` cuando el bundle está optimizado para producción. */
  production: false,
  /**
   * Prefijo de API; vacío porque en desarrollo el proxy reenvía `/api` al backend.
   */
  apiBase: "",
};
