# Imagen multi-etapa: compila el monorepo y genera la imagen de la API (Node) o del front (Nginx + Angular).
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# --loglevel=error: oculta avisos npm "deprecated" de dependencias transitivas (p. ej. glob del CLI de Angular);
# el árbol ya no incluye Karma/rimraf@3/glob@7/inflight. Las versiones siguen fijadas por overrides en package.json.
RUN npm ci --loglevel=error

COPY apps/api apps/api
COPY apps/web apps/web

RUN npm run build -w @npwned/api && npm run build -w @npwned/web \
  && npm prune --omit=dev

# --- API: Node en usuario sin privilegios (UID 1001) ---
FROM node:22-bookworm-slim AS api

RUN groupadd --system --gid 1001 npwned \
  && useradd --system --uid 1001 --gid npwned --home-dir /nonexistent --shell /usr/sbin/nologin npwned

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder --chown=npwned:npwned /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=npwned:npwned /app/node_modules ./node_modules
COPY --from=builder --chown=npwned:npwned /app/apps/api/dist ./apps/api/dist

USER npwned
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]

# --- Web: Nginx sin privilegios (imagen oficial), escucha 8080 ---
FROM nginxinc/nginx-unprivileged:stable-alpine AS web

USER root
RUN apk add --no-cache curl

COPY --chown=nginx:nginx deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder --chown=nginx:nginx /app/apps/web/dist/web/browser /usr/share/nginx/html

USER nginx
EXPOSE 8080
