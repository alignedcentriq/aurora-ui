# Build the SPA, then bake the static bundle into nginx.
# Build context is the repo root (see docker-compose.yml: context: .).

# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app

# VITE_ vars are compiled into the bundle at build time.
ARG VITE_MSAL_CLIENT_ID
ARG VITE_MSAL_TENANT_ID
ARG VITE_MSAL_REDIRECT_URI
ARG VITE_MSAL_AUTHORITY
ENV VITE_MSAL_CLIENT_ID=$VITE_MSAL_CLIENT_ID
ENV VITE_MSAL_TENANT_ID=$VITE_MSAL_TENANT_ID
ENV VITE_MSAL_REDIRECT_URI=$VITE_MSAL_REDIRECT_URI
ENV VITE_MSAL_AUTHORITY=$VITE_MSAL_AUTHORITY

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
# TanStack Start SPA mode emits the shell as _shell.html — also expose it as index.html
# so try_files / static servers find a conventional entrypoint.
RUN cp dist/client/_shell.html dist/client/index.html

# ── Serve stage ──────────────────────────────────────────────────────────────
FROM nginx:alpine
# Static SPA lives under /centriq to match vite base + nginx alias.
COPY --from=builder /app/dist/client /usr/share/nginx/html/centriq
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80 443
