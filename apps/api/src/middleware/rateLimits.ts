/**
 * Límites de peticiones por IP para reducir abuso (fuerza bruta y enumeración masiva).
 * Tras un proxy inverso, activar `TRUST_PROXY` en `.env` para que la IP cliente sea la correcta.
 */
import type { RequestHandler } from "express";
import rateLimit from "express-rate-limit";

/** Consultas públicas de comprobación (por IP). */
export const limiteConsultaPublica = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited", message: "Demasiadas consultas. Espera unos minutos." },
}) as unknown as RequestHandler;

/** Intentos de inicio de sesión en el panel (por IP). */
export const limiteLoginAdmin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited", message: "Demasiados intentos de acceso. Espera unos minutos." },
}) as unknown as RequestHandler;
