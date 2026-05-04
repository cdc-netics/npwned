/**
 * Contenedor raíz: cabecera global y salida del enrutador.
 */
import { Component } from "@angular/core";
import { RouterLink, RouterOutlet } from "@angular/router";

@Component({
  selector: "app-root",
  imports: [RouterOutlet, RouterLink],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.scss",
})
export class AppComponent {
  /** Texto de marca en la cabecera. */
  title = "NPwned";
}
