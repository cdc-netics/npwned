/**
 * Middleware Express: exige cabecera `Authorization: Bearer <jwt>` válido con rol admin.
 */
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

/** Contenido mínimo del JWT tras verificar firma. */
export type AdminJwtPayload = { sub: string; role: "admin" };

declare module "express-serve-static-core" {
  interface Request {
    admin?: AdminJwtPayload;
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as AdminJwtPayload;
    if (payload.role !== "admin") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    req.admin = payload;
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
}
