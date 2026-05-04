# NPwned — aplicación web (Angular)

Cliente del monorepo **NPwned**: interfaz pública para comprobar si un **correo** (exacto o con comodín `*`), **RUT**, **usuario** o **nombre para mostrar** aparece en filtraciones indexadas; panel de administración con JWT (**`/admin`**, **`/admin/ingest`**).

**Guía completa** (implementar, ejecutar, producción, usuarios admin, seguridad): ver el [`README.md` en la raíz del monorepo](../README.md).

## Requisitos

- Node.js compatible con **Angular 21** (ver `package.json` del workspace)
- API Express del workspace `@npwned/api` en ejecución (por defecto `http://localhost:3000`)

## Panel admin (resumen)

- **Dashboard** (`/admin`): gestión de incidentes, usuarios admin, analítica de búsquedas, **borrado de una fila** del índice y **borrado en cascada** de un incidente (diálogo de confirmación + `confirmDelete: true` en API). El listado completo de correos por comodín está en la **página pública** (`/`). Detalle: [README del monorepo](../README.md).
- **Ingesta** (`/admin/ingest`): vista previa con perfiles `plain` / combo / CSV / URL+`:`, detección `email_rut` o `email_rut_plus_text`, y volcado al índice.

## Desarrollo

Desde la raíz del monorepo:

```bash
npm run dev -w @npwned/web
```

El servidor de desarrollo usa `proxy.conf.json` para reenviar las rutas `/api` al backend.

Abre `http://localhost:4200/`.

Si usas el **stack Docker** del monorepo, el front se sirve en el puerto configurado (por defecto **8080**), no en el 4200: ver [README raíz](../README.md#docker-forma-recomendada-todo-el-stack) y [`docs/DOCKER.md`](../docs/DOCKER.md).

## Compilación de producción

```bash
npm run build -w @npwned/web
```

Los artefactos quedan en `apps/web/dist/web`.

## Documentación del código

Los comentarios y la documentación JSDoc/TSDoc de los fuentes están en **español**. Los mensajes de error expuestos por la API en JSON (`error`, `invalid_body`, etc.) se mantienen en inglés tipo clave estable para clientes; el texto visible para el usuario está en español en las plantillas Angular.
