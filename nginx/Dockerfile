# Pre-built SPA bundle shipped from local (npm run build runs locally, not in Docker).
# Build context is the repo root (see docker-compose.yml: context: .).
# The dist/client/ folder must exist before running docker compose up --build.
# deploy.sh builds locally and rsyncs dist/ as part of the deploy flow.

FROM nginx:alpine
# Static SPA lives under /centriq to match vite base + nginx alias.
COPY dist/client /usr/share/nginx/html/centriq
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80 443
