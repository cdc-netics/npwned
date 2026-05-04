import { CommonModule } from "@angular/common";
import { Component, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import {
  CheckApiService,
  CheckKind,
  CheckResponse,
} from "../../core/check-api.service";

/**
 * Página principal: comprobación pública estilo “¿estoy filtrado?”.
 */
@Component({
  selector: "app-home",
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: "./home.component.html",
  styleUrl: "./home.component.scss",
})
export class HomeComponent {
  /** Modo de búsqueda: correo o RUT. */
  kind = signal<CheckKind>("email");
  /** Valor escrito por el usuario (ngModel). */
  value = "";
  /** Indica petición en curso. */
  loading = signal(false);
  /** Mensaje de error de red o validación simple en cliente. */
  error = signal<string | null>(null);
  /** Última respuesta del backend o `null`. */
  result = signal<CheckResponse | null>(null);

  constructor(private readonly checkApi: CheckApiService) {}

  inputType(): string {
    return this.kind() === "email" ? "email" : "text";
  }

  fieldPlaceholder(): string {
    switch (this.kind()) {
      case "email":
        return "nombre@ejemplo.cl o *@organizacion.cl";
      case "rut":
        return "12.345.678-5";
      case "username":
        return "nick (también busca ese texto como parte local de correo indexado)";
      case "display_name":
        return "Juan Pérez, García Ana o Jose";
      default:
        return "";
    }
  }

  fieldLabel(): string {
    switch (this.kind()) {
      case "email":
        return "Correo (exacto o con * como comodín)";
      case "rut":
        return "RUT (Chile)";
      case "username":
        return "Usuario / nick (sin @; también busca ese texto como local de correo)";
      case "display_name":
        return "Nombre o apodo (varias palabras o una sola)";
      default:
        return "Valor";
    }
  }

  /** Cambia el tipo de búsqueda y limpia el resultado anterior. */
  setKind(k: CheckKind): void {
    this.kind.set(k);
    this.result.set(null);
    this.error.set(null);
  }

  /** Envía la consulta a la API pública. */
  submit(): void {
    this.error.set(null);
    this.result.set(null);
    const v = this.value.trim();
    if (!v) {
      this.error.set("Ingresa un valor para comprobar.");
      return;
    }
    this.loading.set(true);
    this.checkApi.check(this.kind(), v).subscribe({
      next: (r) => {
        this.result.set(r);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set("No pudimos completar la consulta. Intenta de nuevo.");
      },
    });
  }
}
