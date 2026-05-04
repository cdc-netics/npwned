import { z } from "zod";
import {
  sanitizeRegexEngineFlags,
  type LeakLineExtractionMode,
} from "./extractIdentifierFromLeakLine.js";

const detectField = z.enum(["email_rut", "email_rut_plus_text"]).optional();

const leakProfileBaseUnion = z.union([
  z.object({ mode: z.literal("plain"), stripQuotes: z.boolean().optional(), detect: detectField }),
  z.object({
    mode: z.literal("credential_pair"),
    delimiter: z.enum(["auto", "tab", "|", ";", ":"]),
    stripQuotes: z.boolean().optional(),
    detect: detectField,
  }),
  z.object({
    mode: z.literal("csv"),
    columnIndex: z.number().int().min(0).max(1024),
    separator: z.enum([",", ";", "|"]).optional(),
    columnPick: z.enum(["fixed", "auto_rut_email"]).optional(),
    stripQuotes: z.boolean().optional(),
    detect: detectField,
  }),
  z.object({
    mode: z.literal("https_path_colons"),
    identifierSegmentIndex: z.number().int().min(0).max(32),
    passwordSegmentIndex: z.number().int().min(0).max(32).optional(),
    stripQuotes: z.boolean().optional(),
    detect: detectField,
  }),
  z.object({
    mode: z.literal("regex_capture"),
    pattern: z.string().min(1).max(512),
    flags: z.string().max(4).optional(),
    captureGroupIndex: z.number().int().min(0).max(32).optional(),
    stripQuotes: z.boolean().optional(),
    detect: detectField,
  }),
]);

/** Perfil de extracción validado (misma forma en API, scripts y cliente). */
export const leakProfileSchema = leakProfileBaseUnion.superRefine((data, ctx) => {
  if (data.mode !== "regex_capture") return;
  try {
    void new RegExp(data.pattern, sanitizeRegexEngineFlags(data.flags));
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Patrón regex inválido (revisa escapes y paréntesis).",
      path: ["pattern"],
    });
  }
}) as z.ZodType<LeakLineExtractionMode>;
