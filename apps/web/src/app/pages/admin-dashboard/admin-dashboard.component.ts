import { CommonModule } from "@angular/common";
import { Component, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import {
  AdminApiService,
  AdminUserRow,
  BreachRow,
  SearchOverview,
} from "../../core/admin-api.service";
import { AuthService } from "../../core/auth.service";
import { forkJoin } from "rxjs";

/**
 * Panel mínimo: lista de incidentes, administradores, métricas de búsqueda y cierre de sesión.
 */
@Component({
  selector: "app-admin-dashboard",
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: "./admin-dashboard.component.html",
  styleUrl: "./admin-dashboard.component.scss",
})
export class AdminDashboardComponent implements OnInit {
  items = signal<BreachRow[]>([]);
  users = signal<AdminUserRow[]>([]);
  overview = signal<SearchOverview | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  newUsername = "";
  newPassword = "";
  userFeedback = signal<string | null>(null);
  creatingUser = signal(false);
  materializing = signal(false);
  materializeMsg = signal<string | null>(null);

  leakDelBreachId = "";
  leakDelType: "email" | "rut_cl" | "username" | "display_name" = "email";
  leakDelValue = "";
  leakDelMsg = signal<string | null>(null);
  leakDeleting = signal(false);

  breachFullDeleteId = "";
  breachFullDeleting = signal(false);
  breachFullMsg = signal<string | null>(null);
  breachDeleteDialogOpen = signal(false);

  constructor(
    private readonly adminApi: AdminApiService,
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    this.reloadPanelData();
  }

  private reloadPanelData(): void {
    this.error.set(null);
    this.loading.set(true);
    forkJoin({
      breaches: this.adminApi.listBreaches(),
      users: this.adminApi.listUsers(),
      overview: this.adminApi.getSearchOverview(7),
    }).subscribe({
      next: ({ breaches, users, overview }) => {
        this.items.set(breaches.items);
        this.users.set(users.items);
        this.overview.set(overview);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set("No se pudo cargar el panel.");
      },
    });
  }

  /** Elimina el token y vuelve al login. */
  logout(): void {
    this.auth.clear();
    void this.router.navigateByUrl("/admin/login");
  }

  /** Crea un administrador adicional y refresca la tabla. */
  createUser(): void {
    this.userFeedback.set(null);
    const u = this.newUsername.trim();
    const p = this.newPassword;
    if (u.length < 2) {
      this.userFeedback.set("Usuario demasiado corto.");
      return;
    }
    if (p.length < 12) {
      this.userFeedback.set("La contraseña debe tener al menos 12 caracteres.");
      return;
    }
    this.creatingUser.set(true);
    this.adminApi.createUser(u, p).subscribe({
      next: () => {
        this.newUsername = "";
        this.newPassword = "";
        this.creatingUser.set(false);
        this.userFeedback.set("Usuario creado correctamente.");
        this.adminApi.listUsers().subscribe((r) => this.users.set(r.items));
      },
      error: (err) => {
        this.creatingUser.set(false);
        if (err?.status === 409) {
          this.userFeedback.set("Ese nombre de usuario ya existe.");
        } else {
          this.userFeedback.set("No se pudo crear el usuario.");
        }
      },
    });
  }

  /** Texto del incidente seleccionado para el diálogo de borrado en cascada. */
  selectedBreachDeleteLabel(): string {
    const id = this.breachFullDeleteId.trim();
    const b = this.items().find((x) => x.id === id);
    return b ? `${b.name} (${b.slug})` : "—";
  }

  openBreachDeleteDialog(): void {
    this.breachFullMsg.set(null);
    if (!this.breachFullDeleteId.trim()) {
      this.breachFullMsg.set("Elige un incidente a borrar.");
      return;
    }
    this.breachDeleteDialogOpen.set(true);
  }

  closeBreachDeleteDialog(): void {
    if (this.breachFullDeleting()) return;
    this.breachDeleteDialogOpen.set(false);
  }

  confirmDeleteEntireBreach(): void {
    this.breachFullMsg.set(null);
    const breachId = this.breachFullDeleteId.trim();
    if (!breachId) {
      this.breachFullMsg.set("Elige un incidente a borrar.");
      this.closeBreachDeleteDialog();
      return;
    }
    this.breachFullDeleting.set(true);
    this.adminApi.deleteBreachWithIndex({ breachId, confirmDelete: true }).subscribe({
      next: (r) => {
        this.breachFullDeleting.set(false);
        this.breachDeleteDialogOpen.set(false);
        this.breachFullMsg.set(
          `Hecho: ${r.leakIndexDeletedCount} fila(s) en leak_index y incidente «${r.slug}» ${
            r.breachDeleted ? "eliminado" : "no eliminado (revisa)"
          }.`,
        );
        this.breachFullDeleteId = "";
        this.leakDelBreachId = "";
        this.reloadPanelData();
      },
      error: (err) => {
        this.breachFullDeleting.set(false);
        if (err?.status === 400) {
          this.breachFullMsg.set("Petición no válida (revisa sesión o recarga el panel).");
        } else if (err?.status === 404) {
          this.breachFullMsg.set("Ese incidente ya no existe.");
          this.breachDeleteDialogOpen.set(false);
        } else {
          this.breachFullMsg.set("No se pudo borrar el incidente.");
        }
      },
    });
  }

  deleteLeakIndexRow(): void {
    this.leakDelMsg.set(null);
    const breachId = this.leakDelBreachId.trim();
    const value = this.leakDelValue.trim();
    if (!breachId) {
      this.leakDelMsg.set("Elige un incidente.");
      return;
    }
    if (!value) {
      this.leakDelMsg.set("Escribe el valor a borrar (correo, RUT, usuario o nombre).");
      return;
    }
    this.leakDeleting.set(true);
    this.adminApi.deleteLeakIndexEntry({ breachId, type: this.leakDelType, value }).subscribe({
      next: (r) => {
        this.leakDeleting.set(false);
        if (r.deletedCount === 0) {
          this.leakDelMsg.set("No había ninguna fila con ese tipo y valor en ese incidente.");
        } else {
          this.leakDelMsg.set("Entrada eliminada del índice.");
          this.leakDelValue = "";
        }
      },
      error: (err) => {
        this.leakDeleting.set(false);
        if (err?.status === 400) {
          this.leakDelMsg.set("Valor no válido para ese tipo (revisa formato o dominio con punto en correo).");
        } else {
          this.leakDelMsg.set("No se pudo borrar. Revisa sesión o consola de red.");
        }
      },
    });
  }

  /** Materializa el día UTC de ayer en `search_stats_daily` (para gráficos / histórico). */
  materializeYesterday(): void {
    this.materializeMsg.set(null);
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    const day = d.toISOString().slice(0, 10);
    this.materializing.set(true);
    this.adminApi.materializeSearchDay(day).subscribe({
      next: () => {
        this.materializing.set(false);
        this.materializeMsg.set(`Día ${day} materializado en search_stats_daily.`);
      },
      error: () => {
        this.materializing.set(false);
        this.materializeMsg.set("No se pudo materializar.");
      },
    });
  }
}
