import { HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { AuthService } from "./auth.service";

/**
 * Añade `Authorization: Bearer` a las peticiones hacia `/api/admin`, salvo el login.
 */
export const adminHttpInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const url = req.url;
  if (
    url.startsWith("/api/admin") &&
    !url.includes("/api/admin/login") &&
    auth.token()
  ) {
    return next(
      req.clone({
        setHeaders: { Authorization: `Bearer ${auth.token()}` },
      }),
    );
  }
  return next(req);
};
