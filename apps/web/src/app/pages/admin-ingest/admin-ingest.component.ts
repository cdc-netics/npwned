import { CommonModule } from "@angular/common";
import { Component, ElementRef, OnInit, ViewChild, computed, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { firstValueFrom } from "rxjs";
import {
  AdminApiService,
  BreachRow,
  IngestPreviewResponse,
  IngestPreviewRow,
  IngestProfile,
  IngestCommitResponse,
  IdentifierDetectMode,
  IngestProfileSuggestionResponse,
} from "../../core/admin-api.service";

const MAX_PREVIEW_LINES = 2500;
const MAX_PREVIEW_BYTES = 1_800_000;

type ProfileMode = "plain" | "combo" | "csv" | "regex";
type RowFilter = "all" | "ok" | "problems";

/**
 * Ingesta manual: vista prevía línea a línea y confirmación antes de escribir en `leak_index`.
 */
@Component({
  selector: "app-admin-ingest",
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: "./admin-ingest.component.html",
  styleUrl: "./admin-ingest.component.scss",
})
export class AdminIngestComponent implements OnInit {
  breaches = signal<BreachRow[]>([]);
  breachId = "";
  profileMode: ProfileMode = "combo";
  comboDelimiter: "auto" | "tab" | "|" | ";" | ":" = "auto";
  csvColumnIndex = 0;
  csvSeparator: "," | ";" | "|" = ",";
  /** Primera celda con RUT (forma explícita) o correo; evita confundir totalizadores con RUT. */
  csvAutoColumn = false;
  /** Modo «plantilla regex»: un patrón con grupo(s) de captura; atajos rellenan el cuadro. */
  regexPattern = "";
  regexCaptureGroup = 1;
  regexFlagI = true;
  regexFlagM = false;
  /** Columna 1-based para el atajo «Texto entre pipes en columna N». */
  regexPipeColumn = 3;
  /**
   * Si está activo, además de correo y RUT se indexan celdas reconocibles como usuario (sin espacio)
   * o nombre/apodo con letras, una o varias palabras (perfil `detect: email_rut_plus_text`).
   */
  detectPlusText = false;
  loadingList = signal(true);
  /** Recarga de lista sin ocultar toda la pantalla (p. ej. tras crear incidente o «Actualizar»). */
  breachesRefreshing = signal(false);
  /** Solo fallos al pulsar «Actualizar» (no tapa toda la página). */
  breachListRefreshError = signal<string | null>(null);
  listError = signal<string | null>(null);

  /** Crear incidente desde esta pantalla (caja destacada si no hay ninguno, o «Crear otro incidente»). */
  createName = "";
  createSlug = "";
  createDescription = "";
  creatingIncident = signal(false);
  createFeedback = signal<string | null>(null);

  /** Uno o varios archivos para el mismo incidente y perfil (volcado secuencial). */
  selectedFiles = signal<File[]>([]);
  /** Qué archivo muestra la vista previa cuando hay varios seleccionados. */
  previewFileIndex = signal(0);
  @ViewChild("ingestFileInput") private ingestFileInput?: ElementRef<HTMLInputElement>;

  previewLoading = signal(false);
  suggestLoading = signal(false);
  previewError = signal<string | null>(null);
  preview = signal<IngestPreviewResponse | null>(null);
  autoDetectInfo = signal<string | null>(null);
  showAdvanced = signal(false);

  rowFilter = signal<RowFilter>("all");
  filteredRows = computed(() => {
    const p = this.preview();
    if (!p) return [];
    const f = this.rowFilter();
    if (f === "all") return p.rows;
    if (f === "ok") return p.rows.filter((r) => r.status === "ok");
    return p.rows.filter((r) => r.status !== "ok");
  });

  /** Filas de la vista previa sustituidas por correcciones manuales (solo UI). */
  rowRepairs = signal<Record<number, IngestPreviewRow>>({});
  repairDrafts = signal<Record<number, string>>({});
  repairApplyError = signal<Record<number, string | null>>({});

  displayRows = computed(() => {
    const rep = this.rowRepairs();
    return this.filteredRows().map((r) => {
      const o = rep[r.lineNo];
      return o ? { ...r, ...o } : r;
    });
  });

  commitLoading = signal(false);
  commitError = signal<string | null>(null);
  /** Resultado por archivo tras un volcado (uno o varios). */
  commitOutcomes = signal<{ fileName: string; result?: IngestCommitResponse; error?: string }[]>([]);
  commitProgressLabel = signal<string | null>(null);

  readonly maxPreviewLines = MAX_PREVIEW_LINES;

  readonly selectedFileCount = computed(() => this.selectedFiles().length);

  readonly commitFinished = computed(() => this.commitOutcomes().length > 0);
  readonly commitOkCount = computed(() => this.commitOutcomes().filter((o) => o.result).length);
  readonly commitFailCount = computed(() => this.commitOutcomes().filter((o) => o.error).length);

  constructor(private readonly adminApi: AdminApiService) {}

  ngOnInit(): void {
    this.loadBreaches(true);
  }

  /**
   * @param initialLoad Si es la carga inicial, muestra el estado «Cargando incidentes…» a pantalla completa.
   */
  loadBreaches(initialLoad: boolean): void {
    if (initialLoad) {
      this.loadingList.set(true);
      this.listError.set(null);
    } else {
      this.breachesRefreshing.set(true);
      this.breachListRefreshError.set(null);
    }
    this.adminApi.listBreaches().subscribe({
      next: (r) => {
        if (initialLoad) this.loadingList.set(false);
        else this.breachesRefreshing.set(false);
        this.breachListRefreshError.set(null);
        this.breaches.set(r.items);
        if (r.items.length > 0) {
          const stillValid = r.items.some((b) => b.id === this.breachId);
          if (!this.breachId || !stillValid) {
            this.breachId = r.items[0]!.id;
          }
        } else {
          this.breachId = "";
        }
      },
      error: (err) => {
        if (initialLoad) this.loadingList.set(false);
        else this.breachesRefreshing.set(false);
        if (initialLoad) {
          if (err?.status === 401 || err?.status === 403) {
            this.listError.set("Sesión caducada o sin permiso. Vuelve a iniciar sesión en /admin/login.");
          } else {
            this.listError.set("No se pudo cargar la lista de incidentes.");
          }
        } else {
          this.breachListRefreshError.set(
            err?.status === 401 || err?.status === 403
              ? "Sesión caducada. Vuelve a iniciar sesión."
              : "No se pudo actualizar la lista.",
          );
        }
      },
    });
  }

  fillSlugFromName(): void {
    if (!this.createName.trim()) return;
    const name = this.createName.trim();
    const base = name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100);
    this.createSlug =
      base.length >= 2 ? base : "incidente-" + Date.now().toString(36).slice(-8);
  }

  createIncident(): void {
    this.createFeedback.set(null);
    const name = this.createName.trim();
    let slug = this.createSlug.trim().toLowerCase();
    if (name.length < 2) {
      this.createFeedback.set("El nombre debe tener al menos 2 caracteres.");
      return;
    }
    if (slug.length < 2 || !/^[a-z0-9-]+$/.test(slug)) {
      this.createFeedback.set(
        "El slug debe ser minúsculas, números y guiones (p. ej. filtracion-enero-2024). Usa «Sugerir slug».",
      );
      return;
    }
    this.creatingIncident.set(true);
    const desc = this.createDescription.trim();
    this.adminApi
      .createBreach({
        name,
        slug,
        description: desc.length ? desc : undefined,
      })
      .subscribe({
        next: (r) => {
          this.creatingIncident.set(false);
          this.createName = "";
          this.createSlug = "";
          this.createDescription = "";
          this.createFeedback.set("Incidente creado. Ya aparece en el desplegable; elige destino y genera vista previa.");
          this.breachId = r.id;
          this.loadBreaches(false);
        },
        error: (err) => {
          this.creatingIncident.set(false);
          if (err?.status === 409) {
            this.createFeedback.set("Ese slug ya existe; cambia el slug.");
          } else if (err?.status === 400) {
            this.createFeedback.set("Datos no válidos. Revisa nombre y slug.");
          } else {
            this.createFeedback.set("No se pudo crear el incidente.");
          }
        },
      });
  }

  onFilePick(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const list = input.files?.length ? Array.from(input.files) : [];
    this.selectedFiles.set(list);
    this.previewFileIndex.set(0);
    this.preview.set(null);
    this.commitOutcomes.set([]);
    this.commitProgressLabel.set(null);
    this.previewError.set(null);
    this.autoDetectInfo.set(null);
    this.commitError.set(null);
    this.clearAllRepairs();
  }

  onPreviewFileIndexChange(index: number): void {
    this.previewFileIndex.set(Math.max(0, Math.floor(index)));
    this.preview.set(null);
    this.commitOutcomes.set([]);
    this.commitProgressLabel.set(null);
    this.previewError.set(null);
    this.autoDetectInfo.set(null);
    this.commitError.set(null);
    this.clearAllRepairs();
  }

  private previewSourceFile(): File | null {
    const files = this.selectedFiles();
    if (files.length === 0) return null;
    const i = Math.min(this.previewFileIndex(), files.length - 1);
    return files[i] ?? null;
  }

  buildProfile(): IngestProfile {
    const detect: IdentifierDetectMode | undefined = this.detectPlusText
      ? "email_rut_plus_text"
      : undefined;
    if (this.profileMode === "plain") return { mode: "plain", ...(detect ? { detect } : {}) };
    if (this.profileMode === "combo") {
      return { mode: "credential_pair", delimiter: this.comboDelimiter, ...(detect ? { detect } : {}) };
    }
    if (this.profileMode === "regex") {
      const flags = `${this.regexFlagI ? "i" : ""}${this.regexFlagM ? "m" : ""}`;
      return {
        mode: "regex_capture",
        pattern: this.regexPattern.trim(),
        captureGroupIndex: Math.max(0, Math.min(32, Math.floor(this.regexCaptureGroup))),
        ...(flags ? { flags } : {}),
        ...(detect ? { detect } : {}),
      };
    }
    return {
      mode: "csv",
      columnIndex: Math.max(0, Math.floor(this.csvColumnIndex)),
      separator: this.csvSeparator,
      ...(this.csvAutoColumn ? { columnPick: "auto_rut_email" as const } : {}),
      ...(detect ? { detect } : {}),
    };
  }

  applyRegexPreset(kind: "rut" | "email" | "username_loose" | "pipe_column"): void {
    switch (kind) {
      case "rut":
        this.regexPattern = "(\\d{7,8}-[\\dkK])";
        this.regexCaptureGroup = 1;
        break;
      case "email":
        this.regexPattern = "([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})";
        this.regexCaptureGroup = 1;
        break;
      case "username_loose":
        this.regexPattern = "([a-zA-Z0-9._-]{3,64})";
        this.regexCaptureGroup = 1;
        break;
      case "pipe_column": {
        const n = Math.max(1, Math.min(64, Math.floor(this.regexPipeColumn || 1)));
        const k = n - 1;
        this.regexPattern = `^(?:[^|]*\\|){${k}}\\s*([^|]+?)\\s*(?:\\||$)`;
        this.regexCaptureGroup = 1;
        break;
      }
      default:
        break;
    }
  }

  private formatPreviewHttpError(err: { status?: number; error?: unknown }): string {
    const s = err?.status;
    if (s === 401 || s === 403) {
      return "Sesión caducada o sin permiso. Abre otra pestaña en /admin/login y vuelve aquí.";
    }
    if (s === 413) {
      return "El servidor rechazó el tamaño del cuerpo (413). Reconstruye la API (`docker compose up -d --build api`) o reduce el archivo de muestra.";
    }
    if (s === 400) {
      return "La API no aceptó el cuerpo (400). Revisa modo CSV/columna, patrón regex o contacta al administrador.";
    }
    if (s === 0 || s === undefined) {
      return "Sin respuesta del servidor (¿API caída o CORS?). Comprueba la consola de red (F12).";
    }
    return `Error HTTP ${s}. Revisa la consola de red (F12).`;
  }

  /** Vista prevía no requiere incidente; solo el volcado final sí. */
  runPreview(): void {
    const file = this.previewSourceFile();
    this.previewError.set(null);
    this.commitOutcomes.set([]);
    if (!file) {
      this.previewError.set("Selecciona al menos un archivo.");
      return;
    }
    if (this.profileMode === "regex" && !this.regexPattern.trim()) {
      this.previewError.set(
        "Escribe un patrón en el cuadro regex o pulsa un atajo (RUT, correo, columna con pipes…).",
      );
      return;
    }
    this.previewLoading.set(true);
    this.autoDetectInfo.set(null);
    this.preview.set(null);
    const slice = file.slice(0, MAX_PREVIEW_BYTES);
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      const lines = text.split(/\r?\n/);
      const capped = lines.slice(0, MAX_PREVIEW_LINES);
      this.adminApi.previewIngest(capped, this.buildProfile()).subscribe({
        next: (res) => {
          this.clearAllRepairs();
          this.preview.set(res);
          this.previewLoading.set(false);
        },
        error: (err) => {
          this.previewLoading.set(false);
          this.previewError.set(this.formatPreviewHttpError(err));
        },
      });
    };
    reader.onerror = () => {
      this.previewLoading.set(false);
      this.previewError.set("No se pudo leer el archivo.");
    };
    reader.readAsText(slice, "UTF-8");
  }

  private applySuggestedProfile(profile: IngestProfile): void {
    this.detectPlusText = profile.detect === "email_rut_plus_text";
    if (profile.mode === "plain") {
      this.profileMode = "plain";
      return;
    }
    if (profile.mode === "credential_pair") {
      this.profileMode = "combo";
      this.comboDelimiter = profile.delimiter;
      return;
    }
    if (profile.mode === "csv") {
      this.profileMode = "csv";
      this.csvSeparator = profile.separator ?? ",";
      this.csvAutoColumn = profile.columnPick === "auto_rut_email";
      this.csvColumnIndex = profile.columnIndex;
      return;
    }
    if (profile.mode === "regex_capture") {
      this.profileMode = "regex";
      this.regexPattern = profile.pattern;
      this.regexCaptureGroup = profile.captureGroupIndex ?? 1;
      const flags = profile.flags ?? "";
      this.regexFlagI = flags.includes("i");
      this.regexFlagM = flags.includes("m");
      return;
    }
    if (profile.mode === "https_path_colons") {
      this.profileMode = "plain";
      return;
    }
    this.profileMode = "plain";
  }

  autoDetectProfile(): void {
    const file = this.previewSourceFile();
    this.previewError.set(null);
    this.autoDetectInfo.set(null);
    if (!file) {
      this.previewError.set("Selecciona al menos un archivo.");
      return;
    }
    this.suggestLoading.set(true);
    this.preview.set(null);
    const slice = file.slice(0, MAX_PREVIEW_BYTES);
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      const lines = text.split(/\r?\n/).slice(0, MAX_PREVIEW_LINES);
      this.adminApi.suggestIngestProfile(lines).subscribe({
        next: (res: IngestProfileSuggestionResponse) => {
          this.applySuggestedProfile(res.suggested.profile);
          this.clearAllRepairs();
          this.preview.set(res.preview);
          this.autoDetectInfo.set(
            `Perfil sugerido: ${res.suggested.label} (score ${res.suggested.score}).`,
          );
          this.suggestLoading.set(false);
        },
        error: (err) => {
          this.suggestLoading.set(false);
          this.previewError.set(this.formatPreviewHttpError(err));
        },
      });
    };
    reader.onerror = () => {
      this.suggestLoading.set(false);
      this.previewError.set("No se pudo leer el archivo.");
    };
    reader.readAsText(slice, "UTF-8");
  }

  /** Tras un volcado exitoso: limpia resultado y archivo para evitar un segundo clic por error. */
  prepareNewIngest(): void {
    this.commitOutcomes.set([]);
    this.commitError.set(null);
    this.commitProgressLabel.set(null);
    this.selectedFiles.set([]);
    this.previewFileIndex.set(0);
    this.preview.set(null);
    this.previewError.set(null);
    if (this.ingestFileInput?.nativeElement) {
      this.ingestFileInput.nativeElement.value = "";
    }
    this.clearAllRepairs();
  }

  private formatCommitHttpError(err: { status?: number }): string {
    const s = err?.status;
    if (s === 413) {
      return "Archivo demasiado grande (límite del proxy o de la API).";
    }
    if (s === 401 || s === 403) {
      return "Sesión caducada. Vuelve a /admin/login.";
    }
    return s ? `Error HTTP ${s}.` : "Falló la ingesta (sin respuesta).";
  }

  private readFileSampleLines(file: File): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const slice = file.slice(0, MAX_PREVIEW_BYTES);
      const reader = new FileReader();
      reader.onload = () => {
        const text = typeof reader.result === "string" ? reader.result : "";
        resolve(text.split(/\r?\n/).slice(0, MAX_PREVIEW_LINES));
      };
      reader.onerror = () => reject(new Error("No se pudo leer el archivo para autodetección."));
      reader.readAsText(slice, "UTF-8");
    });
  }

  private async detectProfileForFile(file: File): Promise<IngestProfile> {
    const lines = await this.readFileSampleLines(file);
    const suggested = await firstValueFrom(this.adminApi.suggestIngestProfile(lines));
    return suggested.suggested.profile;
  }

  commit(): void {
    const files = this.selectedFiles();
    this.commitError.set(null);
    if (files.length === 0) {
      this.commitError.set("Selecciona al menos un archivo.");
      return;
    }
    if (!this.breachId) {
      this.commitError.set(
        "Debes tener al menos un incidente destino. Créalo arriba o ejecuta el seed (`npm run docker:seed`).",
      );
      return;
    }
    if (!this.preview()) {
      this.commitError.set("Genera primero una vista previa y revisa el resultado.");
      return;
    }
    if (this.profileMode === "regex" && !this.regexPattern.trim()) {
      this.commitError.set("Completa el patrón regex o usa un atajo antes de confirmar.");
      return;
    }
    this.commitLoading.set(true);
    this.commitOutcomes.set([]);
    this.commitProgressLabel.set(null);
    const baseProfile = this.buildProfile();
    const breachId = this.breachId;
    const autoPerFile = !this.showAdvanced();
    void (async () => {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        try {
          let profile = baseProfile;
          if (autoPerFile) {
            this.commitProgressLabel.set(`Archivo ${i + 1}/${files.length}: detectando perfil en ${file.name}`);
            profile = await this.detectProfileForFile(file);
          }
          this.commitProgressLabel.set(`Archivo ${i + 1}/${files.length}: indexando ${file.name}`);
          const r = await firstValueFrom(this.adminApi.commitIngest(breachId, profile, file));
          this.commitOutcomes.update((rows) => [...rows, { fileName: file.name, result: r }]);
        } catch (err) {
          const e = err as { status?: number };
          const msg = this.formatCommitHttpError(e);
          this.commitOutcomes.update((rows) => [...rows, { fileName: file.name, error: msg }]);
        }
      }
      this.commitLoading.set(false);
      this.commitProgressLabel.set(null);
    })();
  }

  statusLabel(s: IngestPreviewRow["status"]): string {
    switch (s) {
      case "ok":
        return "OK";
      case "skip_line":
        return "Ignorada";
      case "no_cell":
        return "Sin celda";
      case "invalid_id":
        return "Sin tipo reconocido";
      default:
        return s;
    }
  }

  rowClass(s: IngestPreviewRow["status"]): string {
    if (s === "ok") return "row-ok";
    if (s === "skip_line") return "row-skip";
    return "row-warn";
  }

  private clearAllRepairs(): void {
    this.rowRepairs.set({});
    this.repairDrafts.set({});
    this.repairApplyError.set({});
  }

  private defaultRepairDraft(row: IngestPreviewRow): string {
    const c = row.extractedCell ?? "";
    return c.endsWith("…") ? c.slice(0, -1) : c;
  }

  repairDraftFor(row: IngestPreviewRow): string {
    const d = this.repairDrafts()[row.lineNo];
    return d !== undefined ? d : this.defaultRepairDraft(row);
  }

  onRepairDraftChange(lineNo: number, value: string): void {
    this.repairDrafts.update((m) => ({ ...m, [lineNo]: value }));
    this.repairApplyError.update((e) => ({ ...e, [lineNo]: null }));
  }

  applyRepair(row: IngestPreviewRow): void {
    const base = this.preview()?.rows.find((r) => r.lineNo === row.lineNo) ?? row;
    const candidate = this.repairDraftFor(row).trim();
    if (!candidate) {
      this.repairApplyError.update((e) => ({
        ...e,
        [row.lineNo]: "Escribe un valor a normalizar.",
      }));
      return;
    }
    this.adminApi.tryNormalizeCandidate(candidate, this.buildProfile().detect).subscribe({
      next: (res) => {
        if (!res.ok) {
          this.repairApplyError.update((e) => ({
            ...e,
            [row.lineNo]: this.detectPlusText
              ? "No reconoce el texto con las reglas activas (correo, RUT, usuario o nombre)."
              : "No reconoce el texto como correo (dominio con punto) ni RUT. Activa «También usuario/nombre» si aplica.",
          }));
          return;
        }
        this.rowRepairs.update((m) => ({
          ...m,
          [row.lineNo]: {
            ...base,
            status: "ok",
            type: res.type,
            value: res.value,
            extractedCell: candidate.length > 160 ? `${candidate.slice(0, 160)}…` : candidate,
            extractionMethod: "Corrección manual (solo en esta tabla de vista previa)",
          },
        }));
        this.repairApplyError.update((e) => ({ ...e, [row.lineNo]: null }));
      },
      error: () => {
        this.repairApplyError.update((e) => ({
          ...e,
          [row.lineNo]: "Error al contactar la API.",
        }));
      },
    });
  }

  clearRepairRow(lineNo: number): void {
    this.rowRepairs.update((m) => {
      const { [lineNo]: _removed, ...rest } = m;
      return rest;
    });
    this.repairDrafts.update((d) => {
      const { [lineNo]: _removed, ...rest } = d;
      return rest;
    });
    this.repairApplyError.update((e) => {
      const { [lineNo]: _removed, ...rest } = e;
      return rest;
    });
  }

  repairErr(lineNo: number): string | null {
    return this.repairApplyError()[lineNo] ?? null;
  }

  /**
   * Reparación: siempre en filas con duda; en **OK** solo si la línea parece URL o se tomó toda la línea
   * en plano (donde antes podían colarse falsos positivos). Así una fila «OK» dudosa sigue teniendo cuadro + Aplicar.
   */
  showRepairUi(row: IngestPreviewRow): boolean {
    if (row.status === "skip_line") return false;
    if (this.rowRepairs()[row.lineNo]) return true;
    if (row.status !== "ok") return true;
    const raw = row.rawTruncated ?? "";
    const em = row.extractionMethod ?? "";
    if (raw.includes("://")) return true;
    if (em.includes("Toda la línea (modo plano)")) return true;
    if (em.includes("Combo automático: primer separador")) return true;
    if (em.includes("Tabla con «|»") && (row.extractedCell ?? "").length < 7) return true;
    return false;
  }

  trackByLineNo(_index: number, row: IngestPreviewRow): number {
    return row.lineNo;
  }

  /** Etiqueta corta para la columna «tipo» en la tabla. */
  showUrlColonStrip(row: IngestPreviewRow): boolean {
    return !!(row.urlColonSegments && row.urlColonSegments.length >= 2);
  }

  colonChipKind(row: IngestPreviewRow, i: number): "path" | "id" | "pass" | "neutral" {
    if (i === 0) return "path";
    if (row.urlColonIdentifierSegmentIndex === i) return "id";
    const segs = row.urlColonSegments;
    const last = (segs?.length ?? 0) - 1;
    if (last >= 2 && i === last) return "pass";
    return "neutral";
  }

  colonChipTitle(row: IngestPreviewRow, i: number): string {
    const k = this.colonChipKind(row, i);
    if (k === "path") return "Ruta bajo el host (página; no se indexa como id)";
    if (k === "id") return "Trozo usado como candidato (automático o el que aplicaste)";
    if (k === "pass") return "Suele ser la contraseña (referencia; no se indexa)";
    return "Otro campo tras «:»";
  }

  pickColonSegment(row: IngestPreviewRow, segmentIndex: number): void {
    const seg = row.urlColonSegments?.[segmentIndex];
    if (seg === undefined) return;
    this.onRepairDraftChange(row.lineNo, seg);
  }

  colonSegPreview(s: string, max = 56): string {
    const t = (s ?? "").replace(/\r?\n/g, " ");
    return t.length > max ? `${t.slice(0, max)}…` : t;
  }

  typeLabel(t: IngestPreviewRow["type"]): string {
    switch (t) {
      case "email":
        return "correo";
      case "rut_cl":
        return "RUT";
      case "username":
        return "usuario";
      case "display_name":
        return "nombre";
      case "national_id":
        return "id nacional";
      case "internal_id":
        return "id interno";
      default:
        return String(t ?? "");
    }
  }
}
