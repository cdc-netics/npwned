/**
 * Herramienta CLI: lee un archivo línea a línea y muestra identificadores normalizados (sin contraseñas).
 *
 * Uso (desde `apps/api`):
 *   npx tsx src/scripts/previewLeakLines.ts --format combo ruta/al/archivo.txt
 *   npx tsx src/scripts/previewLeakLines.ts --format plain ruta/al/archivo.csv
 *   npx tsx src/scripts/previewLeakLines.ts --format csv --col 2 --sep , datos.csv
 *   npx tsx src/scripts/previewLeakLines.ts --format combo --plus-text lista.txt
 *
 * Formatos: `plain` | `combo` (credential_pair auto) | `csv` (requiere --col).
 * Opción `--plus-text`: mismo `detect` que la ingesta web (usuario / nombre además de correo y RUT).
 */
import { readFileSync } from "fs";
import {
  extractIdentifierFromLeakLine,
  type LeakLineExtractionMode,
} from "../ingestion/extractIdentifierFromLeakLine.js";

function usage(): never {
  // eslint-disable-next-line no-console -- CLI
  console.error(
    "Uso: previewLeakLines.ts --format plain|combo|csv [--col N] [--sep ,|;] [--plus-text] <archivo>",
  );
  process.exit(1);
}

function parseArgs(argv: string[]): { file: string; profile: LeakLineExtractionMode } {
  let format: string | null = null;
  let col: number | null = null;
  let sep: "," | ";" | null = null;
  let plusText = false;
  const rest: string[] = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--format" && argv[i + 1]) {
      format = argv[++i]!;
    } else if (a === "--col" && argv[i + 1]) {
      col = Number(argv[++i]!);
    } else if (a === "--sep" && argv[i + 1]) {
      const s = argv[++i]!;
      if (s === "," || s === ";") sep = s;
    } else if (a === "--plus-text") {
      plusText = true;
    } else if (!a.startsWith("-")) {
      rest.push(a);
    }
  }
  const file = rest[0];
  if (!file || !format) usage();
  const detect = plusText ? ("email_rut_plus_text" as const) : undefined;
  if (format === "plain") {
    return { file, profile: { mode: "plain" as const, ...(detect ? { detect } : {}) } };
  }
  if (format === "combo") {
    return {
      file,
      profile: { mode: "credential_pair" as const, delimiter: "auto" as const, ...(detect ? { detect } : {}) },
    };
  }
  if (format === "csv") {
    if (col === null || Number.isNaN(col) || col < 0) usage();
    return {
      file,
      profile: {
        mode: "csv" as const,
        columnIndex: col,
        separator: sep ?? ",",
        ...(detect ? { detect } : {}),
      },
    };
  }
  usage();
}

function main(): void {
  const { file, profile } = parseArgs(process.argv);
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const parsed = extractIdentifierFromLeakLine(line, profile);
    // eslint-disable-next-line no-console -- salida JSONL intencional
    console.log(
      JSON.stringify({
        line: i + 1,
        ok: Boolean(parsed),
        type: parsed?.type ?? null,
        value: parsed?.value ?? null,
      }),
    );
  }
}

main();
