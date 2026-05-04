# NPwned

Monorepo: **Angular 21** (consulta pública + panel admin), **Express 5** (API TypeScript) y **MongoDB 8** (índice de filtraciones, analítica y configuración futura).

La documentación de **código** (comentarios) está en español en `apps/api` y `apps/web`.

---

## Docker (forma recomendada: todo el stack)

El archivo **`docker-compose.yml`** levanta **MongoDB 8 + API + Nginx** (Angular compilado). Mongo y la API **no** exponen puertos al host; solo el front publica HTTP (por defecto **8080** → contenedor **8080**).

**Guía detallada** (variables, resguardos, troubleshooting, actualización): **[`docs/DOCKER.md`](docs/DOCKER.md)**.

### Inicio rápido

```bash
copy .env.example .env
REM Edita JWT_SECRET, ADMIN_PASSWORD y alinea CORS_ORIGIN con la URL real (p. ej. http://localhost:8080)
npm run docker:build
npm run docker:up
npm run docker:seed
```

En **PowerShell**, encadenar con `&` ejecuta el siguiente comando en **segundo plano** (no es “y luego”). Para build y luego up usa `;` o líneas separadas, o un solo `docker compose --env-file .env up -d --build` (ver [`docs/DOCKER.md`](docs/DOCKER.md)).

- Web: `http://localhost:8080` (o el puerto de `NPWNED_HTTP_PORT`; el front va en la red `app` para que Docker **sí** publique el mapeo al host — ver [`docs/DOCKER.md`](docs/DOCKER.md)).
- Salud API (vía proxy): `http://localhost:8080/api/public/health`.

Scripts: `docker:build`, `docker:up`, `docker:down`, `docker:seed`, `docker:logs`. El archivo **`.env`** en la raíz está en `.gitignore` (no lo subas); la plantilla versionada es **`.env.example`**.

**Opcional** — solo Mongo con `27017` en el host (desarrollo híbrido con Node local): `npm run docker:mongo-tool` (`docker-compose.mongo.yml`).

---

## Requisitos

- **Docker Desktop** o motor **Docker Compose v2** para el stack completo.
- **Node.js** 20.19+ o **22+** solo si desarrollas API o Angular **fuera** de Docker (modo alternativo más abajo; el `Dockerfile` usa Node 22).

---

## Desarrollo alternativo (Node en el host)

Si prefieres hot-reload con `ng serve` y la API con `tsx watch`, puedes usar Mongo en Docker **solo** como apoyo:

```bash
npm run docker:mongo-tool
```

Luego `MONGODB_URI=mongodb://127.0.0.1:27017` en `apps/api/.env`.

### 1. Dependencias

En la raíz del proyecto:

```bash
npm install
```

### 2. Variables de entorno (API)

Plantilla versionada: `apps/api/.env.example`. Si no tienes `apps/api/.env`, créalo así:

```bash
copy apps\api\.env.example apps\api\.env
```

(El `.env` real no se versiona: cada quien lo genera desde el `.env.example` de esa carpeta.)

| Variable | Descripción |
|----------|-------------|
| `MONGODB_URI` | URI de conexión (ej. `mongodb://127.0.0.1:27017`). |
| `MONGODB_DB` | Nombre de la base (por defecto `npwned`). |
| `JWT_SECRET` | Secreto para firmar JWT de admin. **Obligatorio cambiarlo en producción.** |
| `ADMIN_USERNAME` | Nombre del **primer** admin si la colección `admins` está vacía. |
| `ADMIN_PASSWORD` | Contraseña en texto plano **solo** para crear ese primer usuario (luego solo queda el hash en Mongo). |
| `PORT` | Puerto HTTP de la API (por defecto `3000`). |
| `CORS_ORIGIN` | Orígenes permitidos del front, separados por coma. |
| `TRUST_PROXY` | `1` o `true` si la API va detrás de nginx/traefik (IP real + rate limit). |

### 3. Datos iniciales (opcional pero recomendado en local)

Con Mongo en marcha:

```bash
npm run seed -w @npwned/api
```

Esto crea índices, el admin si no existe, tipos de identificador y un **incidente demo** con correo `demo@npwned.local` y RUT `12.345.678-5`.

### 4. Levantar API y web

Dos terminales:

```bash
npm run dev -w @npwned/api
npm run dev -w @npwned/web
```

- API: `http://localhost:3000`
- Web (con proxy a la API): `http://localhost:4200`

---

## Normalización de archivos de fugas (combo, CSV, SQL…)

El índice (`leak_index`) solo guarda **identificadores ya normalizados** (correo, RUT chileno, usuario sin espacios o nombre para mostrar, según el perfil) ligados a un **incidente** (`breach_sources`). Las contraseñas u otros campos de las listas **no** se almacenan.

1. **Extracción por formato** (módulo `apps/api/src/ingestion/extractIdentifierFromLeakLine.ts`):
   - **`plain`** (*una celda por línea*): por defecto se usa **toda la línea** como candidato. Además:
     - Si la línea contiene `://` y la ruta incluye **`/login`**, se intenta extraer el tramo de usuario entre `/login` y el siguiente separador (URLs tipo login sin pasar por modo combo).
     - Si encaja en **`https://host/ruta:campo1:campo2…`**, se recorren los segmentos tras los `:` de la ruta y se elige el **primer** trozo que la normalización reconozca como id (vista previa muestra *chips* por segmento y la URL base).
   - **`credential_pair`**: convención *combo*: solo el campo **izquierdo** del **primer** separador (`tab`, `|`, `;`, `:`) o, con `delimiter: "auto"`, el primer separador presente en ese orden (p. ej. `usuario@dominio.com:hash` deja el correo intacto).
   - **`csv`**: parser CSV mínimo con comillas; eliges `columnIndex` (0-based) y separador `,` o `;`.
   - **`https_path_colons`**: perfil explícito para la misma forma URL+ruta+`:`+campos; indicas `identifierSegmentIndex` (y opcionalmente `passwordSegmentIndex` solo como metadato en UI: **no** se indexa la contraseña). Útil cuando quieres fijar el índice sin depender de la heurística del modo `plain`.
2. **`detect` en el perfil JSON** (`email_rut` por defecto):
   - **`email_rut`**: en la celda extraída solo se aceptan **correo** o **RUT** normalizado.
   - **`email_rut_plus_text`**: además **usuario** (sin espacios, nick) y **nombre para mostrar** (incluye una sola palabra con letras, p. ej. un nombre propio corto), según reglas en `apps/api/src/normalizers.ts` (`normalizeLeakUsername`, `normalizeLeakDisplayName`).
3. **Normalización** (`apps/api/src/normalizers.ts`):
   - **Correo en ingesta** (`normalizeEmailForLeakLine`): parte local y dominio no pueden llevar `/`, `:`, `@` extra, etc.; evita marcar como correo una URL entera. En líneas `https://…` sin path claro se intenta extraer un correo incrustado (`host:usuario@dominio:clave`).
   - **Correo en consulta exacta** (`normalizeEmail`): sigue más permisivo donde la API pública lo usa.
   - **RUT**: `normalizeRutCl` acepta puntos, espacios, guiones “raros” (Unicode → ASCII), cuerpo 6–8 dígitos con o sin DV, **9 dígitos seguidos** (cuerpo 8 + DV), y **recalcula el DV** si el texto parece una fuga con DV mal copiado (alineado con cómo quedará en índice si se ingiere corregido).
   - **Nombre para mostrar**: no exige obligatoriamente espacio ni coma; sí letras Unicode razonables y longitud acotada; no sustituye a correo/RUT/usuario.
4. **Líneas ignoradas**: vacías, `#`, `--`, cabeceras obvias `INSERT` / `CREATE` (para no indexar SQL crudo por error). Los volcados SQL reales conviene **preprocesarlos** a CSV o combo antes de ingerir.
5. **Contexto para el usuario**: cada incidente puede llevar **`tags`** (p. ej. `retail`, `2024`, `combo-list`). La API pública las devuelve junto al **nombre** y la **descripción** del incidente para que quede claro *en qué filtración* apareció el dato.

Vista previa sin escribir en Mongo (JSONL por línea):

```bash
npm run preview-leak-lines -w @npwned/api -- --format combo ruta/al/archivo.txt
npm run preview-leak-lines -w @npwned/api -- --format csv --col 0 --sep , export.csv
```

**Interfaz web (revisión humana):** con sesión admin, abre **`/admin/ingest`**: eliges incidente, modo combo / plano / CSV, subes el archivo, generas **vista prevía** (hasta ~2500 líneas o ~1,8 MB del inicio) y filtras “solo dudas”. El **volcado** (`POST /api/admin/ingest/commit`) envía el archivo en **multipart por streaming** (no se guarda el fichero entero en disco en la API): puede durar mucho; Nginx usa `client_max_body_size 0` y timeouts largos **solo** en esa ruta; el socket del servidor tiene timeout desactivado para esas cargas.

**Listas enormes (p. ej. millones de líneas):** el navegador sigue siendo el cuello de botella para subir decenas de GB; la estrategia robusta es **CLI dentro del contenedor `api`** leyendo un archivo montado por volumen (sin HTTP):

```bash
docker compose --env-file .env run --rm -v /ruta/host/leaks:/leaks:ro api node apps/api/dist/scripts/ingestFile.js --breachId=<ObjectId> --profile="{\"mode\":\"credential_pair\",\"delimiter\":\"auto\"}" /leaks/archivo.txt
```

Desarrollo local (Mongo accesible): `npm run ingest-file -w @npwned/api -- --breachId=... --profile='{"mode":"plain"}' archivo.txt`

**Endpoints de ingesta (JWT admin, prefijo `/api/admin/ingest`):**

| Ruta | Cuerpo | Uso |
|------|--------|-----|
| `POST …/preview-lines` | JSON `{ lines, profile }` (máx. 2500 líneas; límite JSON ~32 MB) | Vista previa sin escribir en Mongo. |
| `POST …/try-normalize` | JSON `{ candidate, detect? }` | Probar un texto suelto con la misma detección que la ingesta. |
| `POST …/commit` | `multipart/form-data`: `breachId`, `profile` (JSON), `file` | Indexación por streaming (archivo no se guarda entero en disco en la API). |

---

## Consulta pública (`POST /api/public/check`)

Cuerpo JSON: `{ "kind": "email" | "rut" | "username" | "display_name", "value": "…" }`.

- **`email`**: correo exacto normalizado **o** patrón con **un solo comodín `*`** en la parte local (mismas reglas que `emailWildcardToRegExp` en la API). La búsqueda por comodín recorre como máximo **6000** filas de `leak_index` (`EMAIL_WILDCARD_ROW_CAP`); si hay más coincidencias, la respuesta indica truncamiento.
- **Respuesta comodín**: además de `found` e incidencias, incluye `wildcard: true`, `matchCount`, `matchCountTruncated` y el array **`emails`**: direcciones **completas** distintas dentro del tramo escaneado (ordenadas). La interfaz pública las muestra; el riesgo de enumeración por dominio queda mitigado solo por **rate limit** y políticas del despliegue (valorar CAPTCHA/WAF si expones el sitio a Internet).
- **`rut`**: mismo normalizador que la ingesta; acepta DV **K** latina y homoglifos comunes (p. ej. ancho completo o cirílico) tras **NFKC** en la cadena.
- **`display_name`**: comparación con **colación** `es` fuerza 2 (mayúsculas/minúsculas equivalentes; tildes sí distinguen). La respuesta puede incluir **`displayNameMatches`**: valores distintos en el índice en el tramo consultado (tope **6000** filas), para distinguir coincidencias ambiguas.
- **`username`**: busca en `leak_index` tipo `username` **y** en tipo `email` donde el valor coincide por regex `^<nick>@` (el mismo texto que el nick, como parte local del correo). Hasta **6000** filas en la parte de correo; si hay más, `usernameEmailMatchesTruncated` en JSON. Si hay coincidencias por correo, la respuesta puede incluir **`usernameEmailMatches`** (lista completa de direcciones en ese tramo).

Cada consulta válida o inválida puede registrarse en **`search_events`** (analítica); ver [`docs/ANALITICA.md`](docs/ANALITICA.md).

---

## Panel admin: índice y borrado

En **`/admin`** (dashboard) y **`/admin/ingest`** están las acciones que llaman a los endpoints siguientes.

### Quitar una fila del índice

- **`POST /api/admin/leak-index/delete-entry`** (JWT)  
  Cuerpo: `{ "breachId": "<ObjectId24>", "type": "email" | "rut_cl" | "username" | "display_name", "value": "…" }`.  
  La API **normaliza** el valor como en ingesta y ejecuta `deleteOne` en `leak_index` para ese par `(breachId, type, value canónico)`. Sirve para corregir un dato indexado por error sin borrar el incidente entero.

### Borrar un incidente completo (cascada índice + metadato)

- **`POST /api/admin/breaches/delete-with-index`** (JWT)  
  Cuerpo: `{ "breachId": "<ObjectId24>", "confirmDelete": true }`.  
  El literal **`confirmDelete: true`** evita borrados accidentales con un cuerpo mínimo; en la web se pide confirmación en un diálogo antes de enviar la petición. Orden en servidor: `deleteMany` en `leak_index` por `breachId`, luego `deleteOne` del incidente.  
  **No** elimina filas de `search_events` (histórico de consultas); si necesitas anonimizar o purgar búsquedas por slug, habría que hacerlo aparte o ampliar la API.

---

## ¿`npm run build` “basta” para que funcione?

**Compila** el TypeScript de la API y el bundle de Angular; **no** sustituye a:

1. **MongoDB** en ejecución y accesible con `MONGODB_URI`.
2. **Variables de entorno** en el entorno donde ejecutes `node apps/api/dist/index.js` (o copies un `.env` junto al proceso / uses el sistema).
3. **Primer usuario admin**: al **arrancar la API**, si la colección `admins` está **vacía**, se ejecuta `seedAdminIfNeeded`: se crea **un** documento con `username` / `passwordHash` (bcrypt) a partir de `ADMIN_USERNAME` y `ADMIN_PASSWORD` del entorno. No es “raro”: es intencional para el **bootstrap**; en producción define **antes del primer arranque** una contraseña fuerte y un `JWT_SECRET` largo y aleatorio.

El comando `seed` además carga datos demo; el **build** no ejecuta el seed.

### Producción sin Docker en el servidor (esquema típico)

```bash
npm run build
```

Luego sirves:

- **API**: `node apps/api/dist/index.js` (o PM2/systemd) con variables de entorno inyectadas.
- **Web**: archivos estáticos en `apps/web/dist/web/browser` detrás de **nginx** (o similar). Misma idea que `deploy/nginx.conf`: mismo host, `location /api/` → backend.

Si prefieres **todo en contenedores**, usa [Docker (forma recomendada)](#docker-forma-recomendada-todo-el-stack) y la guía [`docs/DOCKER.md`](docs/DOCKER.md).

---

## Usuarios administradores: campos y cómo añadir más

### Documento en MongoDB (`admins`)

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `_id` | `ObjectId` | Identificador. |
| `username` | `string` | Único. Letras, números, `.`, `_`, `-`. |
| `passwordHash` | `string` | Hash bcrypt (coste 12); **nunca** contraseña en claro. |
| `createdAt` | `Date` | Alta. |
| `createdBy` | `ObjectId` \| ausente | Quién creó la cuenta (`POST /api/admin/users`). El primer usuario del seed no lo lleva. |

### API (requiere JWT de admin)

- **Listar**: `GET /api/admin/users`
- **Crear**: `POST /api/admin/users` con cuerpo JSON `{ "username": "...", "password": "..." }` (contraseña **mínimo 12** caracteres).

Ejemplo con `curl` (sustituye `TOKEN`):

Con stack Docker (misma URL que el navegador):

```bash
curl -s -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" ^
  -d "{\"username\":\"operador2\",\"password\":\"clave-muy-segura-12+\"}" ^
  http://localhost:8080/api/admin/users
```

Con API en el host (desarrollo típico): `http://localhost:3000/api/admin/users`.

En el panel web (`/admin`) hay un formulario mínimo que llama al mismo endpoint.

---

## Endpoints útiles (resumen)

| Método | Ruta | Auth | Uso |
|--------|------|------|-----|
| `GET` | `/api/public/health` | No | Salud. |
| `POST` | `/api/public/check` | No | `email` (exacto o comodín `*` → `emails` completos), `rut`, `username` (también local de correo → `usernameEmailMatches`), `display_name`. Rate limit por IP; 429 si exceso. |
| `POST` | `/api/admin/login` | No | Login (rate limit por IP; exceso → HTTP 429). |
| `GET` | `/api/admin/me` | JWT | Validar sesión. |
| `GET` | `/api/admin/breaches` | JWT | Listar incidentes. |
| `POST` | `/api/admin/breaches` | JWT | Crear incidente. |
| `POST` | `/api/admin/breaches/delete-with-index` | JWT | Borrar incidente + todas las filas `leak_index` del `breachId` (cuerpo con `confirmDelete: true`). |
| `POST` | `/api/admin/leak-index/delete-entry` | JWT | Borrar **una** entrada del índice (`breachId` + `type` + `value` en bruto, se normaliza en servidor). |
| `POST` | `/api/admin/ingest/preview-lines` | JWT | Vista previa de líneas + perfil de extracción. |
| `POST` | `/api/admin/ingest/try-normalize` | JWT | Probar normalización de un candidato. |
| `POST` | `/api/admin/ingest/commit` | JWT | Ingesta multipart al índice. |
| `GET` | `/api/admin/users` | JWT | Listar admins. |
| `POST` | `/api/admin/users` | JWT | Crear admin. |
| `GET` | `/api/admin/analytics/search-overview?days=7` | JWT | Resumen agregado de `search_events` (hasta 90 días). |
| `POST` | `/api/admin/analytics/search-stats/materialize-day` | JWT | Cuerpo `{ "day": "YYYY-MM-DD" }` → guarda un día en `search_stats_daily`. |
| `GET` | `/api/admin/analytics/search-stats/daily?limit=30` | JWT | Lista días ya materializados. |

**CLI** (misma lógica que `materialize-day`, ayer UTC por defecto): `npm run aggregate-search-stats -w @npwned/api` — ver [`docs/ANALITICA.md`](docs/ANALITICA.md).

Los códigos de error en JSON (`invalid_body`, etc.) son claves estables; mensajes amigables pueden ir en `message` cuando la API los envía.

---

## Auditoría interna (QA seguridad y calidad)

Revisión orientada a **reducción de riesgos**, no certificación formal.

### Mitigaciones ya aplicadas

- **Contraseñas**: bcrypt (12 rondas); nunca se devuelven ni se registran en logs de negocio.
- **JWT**: expiración 12 h; firma con `JWT_SECRET`; rutas admin protegidas con middleware.
- **Helmet**: cabeceras HTTP endurecidas (CSP desactivada en API JSON para evitar romper integraciones).
- **CORS**: restringido a `CORS_ORIGIN` (no abierto a `*` en configuración por defecto).
- **Límite de peticiones** (`express-rate-limit`): consultas públicas `POST /check` y login admin (por IP; con proxy, activar `TRUST_PROXY`).
- **Entrada**: validación con Zod en rutas sensibles; tamaño máximo del JSON (32 KB).
- **Índices Mongo**: unicidad en combinaciones críticas (`leak_index`, `slug` de incidentes, `username` admin).
- **Docker** (stack recomendado): API sin root, `read_only`, `cap_drop`, healthchecks, límites de recursos, logs rotados, Mongo sin puerto público; detalle en [`docs/DOCKER.md`](docs/DOCKER.md).

### Riesgos o deudas conscientes (pendientes de endurecer según tu entorno)

| Riesgo | Notas |
|--------|--------|
| **JWT en `localStorage`** | Vulnerable a XSS en el front. Mitigación fuerte: CSP estricta en el sitio estático, dependencias al día, evitar `innerHTML` con datos externos. Evolución: cookies **httpOnly** + SameSite. |
| **Enumeración** | Un atacante puede probar correos/RUT masivamente; el rate limit reduce abuso pero no lo elimina. Valorar CAPTCHA, WAF o umbral por cuenta. |
| **Secreto JWT** | Si se filtra, se emiten tokens válidos. Rotar secreto implica cerrar sesiones. |
| **Transporte** | En producción usar **HTTPS** terminado en proxy y `Secure` en cookies si migras sesión. |
| **Dependencias** | Ejecutar `npm audit` con regularidad; el ecosistema Angular puede reportar avisos en dev. |
| **Datos personales** | Las búsquedas se registran en `search_events` (analítica); revisar retención y políticas (Ley 19.628, etc.). Borrar un incidente con `/breaches/delete-with-index` **no** purga esos eventos. |
| **Comodín en sitio público** | `POST /check` con patrón `*` puede devolver correos completos del tramo escaneado; combina rate limit, políticas legales y endurecimientos (CAPTCHA/WAF) según exposición. |

### Calidad de código

- TypeScript estricto en la API; validación de cuerpos con Zod.
- Recomendación: añadir tests (API con supertest, front con pruebas de componente) en iteraciones siguientes.

---

## Stack y versiones (referencia)

En el monorepo se usan **Angular 21** y **Express 5** con TypeScript reciente; los números exactos están en los `package.json` de `apps/web` y `apps/api`. La API usa **middleware de rate limit** compatible con Express 5 (tipado explícito donde haga falta).

---

## Más documentación

- **Front (Angular)**: `apps/web/README.md`.
- **Variables de ejemplo (API en host)**: `apps/api/.env.example`.
- **Docker (operación y resguardos)**: [`docs/DOCKER.md`](docs/DOCKER.md).
- **Variables Docker (raíz)**: `.env.example` → copiar a `.env`.
- **Imagen Docker multi-etapa**: `deploy/Dockerfile`.
- **Proxy Nginx del stack Docker**: `deploy/nginx.conf`.
- **Analítica de búsquedas**: [`docs/ANALITICA.md`](docs/ANALITICA.md).
