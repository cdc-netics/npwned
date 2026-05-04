import { CommonModule } from "@angular/common";
import { Component, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { AdminApiService } from "../../core/admin-api.service";
import { AuthService } from "../../core/auth.service";

/**
 * Formulario de acceso al panel de administración.
 */
@Component({
  selector: "app-admin-login",
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: "./admin-login.component.html",
  styleUrl: "./admin-login.component.scss",
})
export class AdminLoginComponent {
  username = "";
  password = "";
  loading = signal(false);
  error = signal<string | null>(null);

  constructor(
    private readonly adminApi: AdminApiService,
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {}

  /** Envía credenciales y, si son válidas, guarda el JWT y navega al panel. */
  submit(): void {
    this.error.set(null);
    this.loading.set(true);
    this.adminApi.login(this.username.trim(), this.password).subscribe({
      next: (r) => {
        this.auth.setToken(r.token);
        this.loading.set(false);
        void this.router.navigateByUrl("/admin");
      },
      error: () => {
        this.loading.set(false);
        this.error.set("Credenciales incorrectas.");
      },
    });
  }
}
