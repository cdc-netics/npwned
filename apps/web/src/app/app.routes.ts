/**
 * Definición de rutas: página pública, login admin y panel protegido por guard.
 */
import { Routes } from "@angular/router";
import { adminAuthGuard } from "./core/admin-auth.guard";
import { AdminDashboardComponent } from "./pages/admin-dashboard/admin-dashboard.component";
import { AdminIngestComponent } from "./pages/admin-ingest/admin-ingest.component";
import { AdminLoginComponent } from "./pages/admin-login/admin-login.component";
import { HomeComponent } from "./pages/home/home.component";

export const routes: Routes = [
  { path: "", component: HomeComponent },
  { path: "admin/login", component: AdminLoginComponent },
  {
    path: "admin/ingest",
    component: AdminIngestComponent,
    canActivate: [adminAuthGuard],
  },
  {
    path: "admin",
    component: AdminDashboardComponent,
    canActivate: [adminAuthGuard],
  },
  { path: "**", redirectTo: "" },
];
