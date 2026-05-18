# Build stage
FROM node:20-slim AS builder
WORKDIR /app

# VITE_ vars must be baked in at build time
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

# Production stage — Nitro bundles all deps into .output/
FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/.output ./.output

EXPOSE 3000
ENV PORT=3000
ENV NODE_ENV=production

CMD ["node", ".output/server/index.mjs"]
