/**
 * Arranque de la aplicación Angular en el navegador (standalone, sin `AppModule`).
 */
import { bootstrapApplication } from "@angular/platform-browser";
import { appConfig } from "./app/app.config";
import { AppComponent } from "./app/app.component";

bootstrapApplication(AppComponent, appConfig).catch((err) => {
  // eslint-disable-next-line no-console -- fallo de arranque irrecuperable
  console.error("Error al iniciar la aplicación:", err);
});
