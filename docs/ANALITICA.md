# Analítica de búsquedas (`search_events`)

Cada consulta pública (`POST /api/public/check`) deja un documento en la colección **`search_events`**: fecha, tipo de consulta (`email`, `rut_cl`, `username`, `display_name`), si hubo coincidencia (`hit`), número de brechas, `breachSlugs` si hubo hit, dominio del correo (si aplica), campos extra para comodín de correo (`wildcardEmail`, recuentos, truncamiento), en **usuario** con local de correo (`usernameEmailLocalMatchCount` / `usernameEmailLocalTruncated`) y en **nombre** (`displayNameRowCount` / `displayNameRowsTruncated`) cuando aplique; y si el valor fue inválido.

**Nota:** borrar un incidente vía `POST /api/admin/breaches/delete-with-index` **no** elimina eventos históricos de `search_events`; las agregaciones siguen reflejando consultas pasadas hasta que definas retención o limpieza aparte.

Eso es el **evento crudo**. Para informes y gráficas conviene **normalizar** en dos niveles:

1. **Consulta al vuelo** — sin guardar nada nuevo: agregación Mongo sobre un rango de fechas.
2. **Materialización diaria** — un documento por día UTC en **`search_stats_daily`** (menos carga si consultas a menudo).

---

## Herramientas disponibles

### 1. API admin (JWT)

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/admin/analytics/search-overview?days=7` | Totales, hits/misses/inválidas, conteos por `queryType`, top 25 dominios. `days` entre 1 y 90 (UTC: desde hoy 00:00 hacia atrás). |
| `POST` | `/api/admin/analytics/search-stats/materialize-day` | Cuerpo JSON `{ "day": "2026-05-02" }` (día **UTC**). Escribe o reemplaza un documento en `search_stats_daily`. |
| `GET` | `/api/admin/analytics/search-stats/daily?limit=30` | Lista los días ya materializados (más recientes primero). |

El panel admin (`/admin`) muestra el resumen de **7 días** y un botón para materializar **ayer UTC**.

### 2. Script CLI

Desde la raíz del monorepo:

```bash
npm run aggregate-search-stats
```

Equivale a `npm run aggregate-search-stats -w @npwned/api`: por defecto materializa **el día UTC anterior**. Para un día concreto:

```bash
npm run aggregate-search-stats -w @npwned/api -- 2026-05-02
```

Útil en **cron** (una vez al día tras medianoche UTC) o en un job del orquestador.

---

## Modelo de datos

### `search_events` (crudo)

- `at`: `Date`
- `queryType`: `"email"` | `"rut_cl"`
- `hit`: `boolean`
- `breachCount`: `number`
- `domain`: `string` opcional (solo búsquedas de correo válidas)
- `invalid`: `boolean` (valor no normalizable)

### `search_stats_daily` (normalizado por día)

- `day`: string `YYYY-MM-DD` (UTC)
- `generatedAt`: cuándo se calculó
- `total`, `hits`, `misses`, `invalid`
- `byQueryType`: mapa nombre → conteo
- `topDomains`: hasta 50 entradas `{ domain, count }`

---

## Próximos pasos posibles

- Gráficos en el front leyendo `search_stats_daily` o series desde `search_events`.
- Política de **retención** (TTL o job que archive/borre eventos antiguos).
- **Umbral mínimo** en top dominios para no filtrar dominios únicos (k-anonimato).
