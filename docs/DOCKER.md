# NPwned — Docker (stack completo y resguardos)

Este documento describe el **despliegue recomendado**: todo el sistema en contenedores (`docker-compose.yml`). La API **no** expone puerto al host; solo el front (Nginx) publica HTTP en el puerto configurado (por defecto **8080**) y enruta `/api/*` al contenedor interno.

---

## Arquitectura

| Servicio | Imagen / build | Rol | Red host |
|----------|------------------|-----|----------|
| `mongo` | `mongo:8.0` | Base de datos; **sin puerto publicado**; solo red interna. | No |
| `api` | `deploy/Dockerfile` → target `api` | Express + Node; usuario **1001**, sistema de archivos **solo lectura** + `tmpfs` `/tmp`. | No |
| `web` | `deploy/Dockerfile` → target `web` | `nginxinc/nginx-unprivileged` + Angular estático; escucha **8080** en el contenedor. | `NPWNED_HTTP_PORT` → `8080` |

Flujo del navegador: `http://HOST:PUERTO/` → Nginx sirve el SPA; `http://HOST:PUERTO/api/...` → proxy a `http://api:3000/api/...`.

### Dos redes: por qué no es una sola `internal` para todos

Docker (moby/moby#36174) puede **no publicar `ports:` al host** si el contenedor está unido a una red bridge con **`internal: true`**. Por eso el stack usa:

| Red | `internal` | Servicios | Rol |
|-----|------------|-----------|-----|
| `db` | **sí** | `mongo`, `api` | Mongo sin exposición al host; sin salida a Internet desde esa red. |
| `app` | **no** | `api`, `web` | La API sigue sin abrir puerto al host; **solo `web`** tiene `ports` y Nginx alcanza `api` por esta red. |

`mongo` no está en `app`, así que el front **no** puede resolver `mongo`. La API está en **ambas** redes: habla con Mongo por `db` y con el proxy por `app`. **Nota:** al estar la API también en `app` (red no interna), en teoría podría abrir salida TCP hacia Internet si el proceso lo intentara; en la práctica la app solo usa Mongo y peticiones entrantes. Para aislamiento estricto de salida de la API habría que capar a nivel firewall del host o políticas adicionales.

### Volúmenes permanentes

- **Stack principal**: el volumen lógico `mongo_data` se materializa en el motor Docker con **nombre fijo** `npwned_mongo_data` (directiva `name:` en Compose). Los datos de WiredTiger viven en `/data/db` dentro del volumen; **`docker compose down` no los borra** (solo se pierden si ejecutas `down -v` o eliminas el volumen manualmente).
- **Solo Mongo (herramienta)**: `docker-compose.mongo.yml` usa el volumen nombrado `npwned_mongo_tool_data`, separado del stack principal para no mezclar entornos.

Copias de seguridad recomendadas (ejemplo con `mongodump` contra el contenedor `mongo` del stack ya levantado):

```bash
docker compose exec mongo mongodump --out=/tmp/dump --db=npwned
docker compose cp mongo:/tmp/dump ./backup-mongo-$(date -u +%Y%m%d)
```

En Windows PowerShell puedes usar una carpeta fija en lugar de `$(date ...)`. Para restaurar, consulta la documentación de `mongorestore` y prueba antes en un entorno no productivo.

---

## Requisitos previos

- **Docker Compose v2** (incluido en Docker Desktop).
- Archivo **`.env`** en la **raíz** del monorepo (nunca lo subas al git). Plantilla: **`.env.example`**.

Hay otro `.env` opcional en **`apps/api/.env`**: solo sirve cuando corres la API con Node en el host (`npm run dev -w @npwned/api`); el contenedor Docker **no** lo usa (el compose inyecta `MONGODB_URI`, etc.).

---

## Primer arranque (checklist)

1. **Copiar variables de entorno**

   ```bash
   copy .env.example .env
   ```

   En Linux/macOS: `cp .env.example .env && chmod 600 .env`

2. **Editar `.env`**

   - `JWT_SECRET`: cadena larga y aleatoria (firma de JWT).
   - `ADMIN_PASSWORD`: contraseña fuerte del primer administrador (bootstrap si `admins` está vacío).
   - `CORS_ORIGIN`: debe ser **exactamente** la URL con la que abrirás el navegador (incluido puerto). Si usas el puerto por defecto: `http://localhost:8080`.
   - `NPWNED_HTTP_PORT`: puerto en tu máquina que mapea al 8080 del contenedor web (por defecto `8080`). Si cambias el puerto aquí, **ajusta también** `CORS_ORIGIN` para que coincidan host y puerto.

3. **Construir imágenes**

   ```bash
   npm run docker:build
   ```

4. **Levantar el stack**

   ```bash
   npm run docker:up
   ```

5. **Cargar índices, admin y datos demo** (recomendado la primera vez)

   ```bash
   npm run docker:seed
   ```

6. **Comprobar**

   - Web: `http://localhost:8080` (o el puerto que hayas puesto).
   - Salud API vía proxy: `http://localhost:8080/api/public/health`.

7. **Logs** (opcional)

   ```bash
   npm run docker:logs
   ```

8. **Apagar** (los datos de Mongo **persisten** en el volumen `npwned_mongo_data`)

   ```bash
   npm run docker:down
   ```

---

## Scripts npm (resumen)

| Script | Acción |
|--------|--------|
| `docker:build` | `docker compose build` (requiere `.env` para validar variables del compose). |
| `docker:up` | Sube `mongo`, `api`, `web` en segundo plano. |
| `docker:down` | Baja servicios (no borra el volumen de datos salvo que uses `-v`). |
| `docker:seed` | Ejecuta el seed dentro de un contenedor temporal `api`. |
| `docker:logs` | Tails de logs de todos los servicios. |
| `docker:mongo-tool` | **Opcional**: solo Mongo con `27017` en el host (`docker-compose.mongo.yml`), para desarrollo híbrido. |

### Mismo flujo con `docker compose` (sin npm)

Desde la **raíz del monorepo**, con `.env` ya creado y editado:

```bash
docker compose --env-file .env build
docker compose --env-file .env up -d
```

En un solo paso (construye `api` y `web` si hace falta y luego levanta):

```bash
docker compose --env-file .env up -d --build
```

Seed (índices, admin bootstrap, demo; recomendable la primera vez):

```bash
docker compose --env-file .env run --rm api node apps/api/dist/scripts/seed.js
```

Logs y apagado:

```bash
docker compose --env-file .env logs -f --tail=200
docker compose --env-file .env down
```

Solo Mongo en el host (herramienta / dev híbrido):

```bash
docker compose -f docker-compose.mongo.yml up -d
```

---

## Resguardos de seguridad aplicados en Compose / imágenes

| Área | Qué se hace |
|------|-------------|
| **Superficie de red** | Mongo y API no publican puertos al host; solo `web` expone HTTP. Red **`db`** internal (mongo + api); red **`app`** normal (api + web) para que el mapeo `ports:` funcione en Docker Desktop. |
| **Usuario API** | Proceso Node bajo UID **1001** (sin root). |
| **Sistema de archivos API** | `read_only: true` + `tmpfs` en `/tmp` (escritura mínima). |
| **Privilegios API** | `cap_drop: ALL`, `security_opt: no-new-privileges:true`. |
| **Init** | `init: true` en `api` y `web` para reaping de procesos zombies. |
| **Helmet / CORS / rate limit** | Configurados en la aplicación Express (ver código y README principal). |
| **Nginx** | Imagen **sin privilegios**; escucha **8080** (no requiere puerto &lt; 1024). |
| **Salud** | `healthcheck` en los tres servicios; `web` espera a que `api` esté sano; API con `fetch` a `/api/public/health`. |
| **Apagado** | `stop_grace_period` en Mongo (60 s) y en API/web para dar tiempo a flush y cierre HTTP; la API cierra Mongo en `SIGTERM`/`SIGINT`. |
| **Límites de proceso** | `pids_limit` y `ulimits.nofile` razonables en Mongo; `pids_limit` en API y web. |
| **Mongo / tmp** | `tmpfs` en `/tmp` de Mongo (`noexec`, `nosuid`) para reducir persistencia accidental de temporales. |
| **Logs** | Rotación `json-file` con `max-size` / `max-file` para no llenar disco. |

### Qué **no** incluye este stack (tú lo añades según entorno)

- **TLS/HTTPS** en el puerto público: en producción suele ir delante un balanceador, Cloudflare o nginx del host con certificados.
- **Autenticación en MongoDB**: la red interna reduce riesgo; en entornos estrictos habilita `--auth` y variables `MONGO_INITDB_ROOT_*` (cambio de compose y `MONGODB_URI` con usuario/contraseña).
- **Secretos gestionados** (Vault, Docker Swarm secrets, Kubernetes Secrets): aquí se usan variables en `.env` por simplicidad.
- **Copias de seguridad** del volumen `npwned_mongo_data`: automatiza `mongodump` o snapshots de disco del volumen según tu proveedor; arriba hay un ejemplo con `docker compose exec` + `docker compose cp`.

---

## Actualización de versión (imagen nueva)

```bash
npm run docker:build
npm run docker:up
```

Si cambia el esquema de datos, ejecuta migraciones o scripts ad hoc según tu proceso; el seed demo es idempotente en gran parte pero **no sustituye** migraciones reales.

---

## Solo MongoDB en el host (opcional)

Si necesitas conectar herramientas locales a Mongo **sin** levantar el stack completo:

```bash
npm run docker:mongo-tool
```

Eso usa `docker-compose.mongo.yml` y un volumen distinto (`npwned_mongo_tool_data`) para no mezclar datos con el stack principal.

---

## Solución de problemas

| Síntoma | Qué revisar |
|---------|-------------|
| No ves puertos en Docker Desktop / no abre el **8080** | `mongo` y `api` **no** publican puertos al host (diseño). Solo **`web`** debe mostrar `0.0.0.0:PUERTO->8080/tcp` (o similar) en `docker compose ps`. Si solo ves `8080/tcp` sin flecha `->`, el contenedor **no** tiene bind al host (antes ocurría con `web` en red `internal: true`; el compose actual separa redes `db` / `app`). Recrea: `docker compose --env-file .env down && docker compose --env-file .env up -d --build`. |
| `pull access denied` para `npwned-api:local` / `npwned-web:local` | Esas imágenes **no están en Docker Hub**: hay que **construirlas** antes o usar `up --build`. Con PowerShell no uses `&` entre comandos si quieres secuencia: `&` lanza el segundo en **segundo plano**, y `up` puede correr **antes** de que termine `build` (Compose intenta hacer pull y falla). Usa `;` o dos líneas, o `docker compose --env-file .env up -d --build`. |
| `couldn't find env file .env` | Crea el archivo copiando `.env.example`. |
| Error de Docker tipo `dockerDesktopLinuxEngine` | Inicia Docker Desktop / motor Docker. |
| Navegador: CORS / login falla | `CORS_ORIGIN` debe coincidir con la URL **exacta** (esquema + host + puerto). |
| `429` en muchas peticiones | Rate limiting activo; espera o ajusta límites en código si es entorno de carga legítima. |
| Healthcheck de `api` falla | Revisa logs: Mongo no listo, `JWT_SECRET` inválido, etc. `npm run docker:logs`. |
| Vista previa de **ingesta** (`/admin/ingest`) responde **413** | El JSON de vista prevía puede superar 1–2 MB; la API usa un parser grande **solo** en `/api/admin/ingest`. Si la imagen `api` es antigua o el orden de middlewares falló, reconstruye: `docker compose --env-file .env up -d --build api`. Nginx ya tiene `client_max_body_size 52m` en `deploy/nginx.conf`. |
| Volcado muy lento o archivos de **muchísimas líneas** | El `POST .../ingest/commit` va en **streaming** (no rellena el disco del contenedor con el archivo). Nginx para esa ruta tiene `client_max_body_size 0` y timeouts largos. Para **decenas de millones de líneas o GB** de archivo, usa el script `ingestFile` montando un volumen (ej. `docker compose run --rm -v /host/leaks:/leaks:ro api node apps/api/dist/scripts/ingestFile.js --breachId=... --profile='...' /leaks/f.txt`) — ver README. |

---

## Archivos relacionados

- `docker-compose.yml` — stack principal.
- `docker-compose.mongo.yml` — solo Mongo (herramienta).
- `deploy/Dockerfile` — build multi-etapa.
- `deploy/nginx.conf` — proxy `/api/` y SPA.
- `.env.example` — plantilla de variables.
