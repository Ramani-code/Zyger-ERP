# syntax=docker/dockerfile:1.7

# ---- Build stage: install deps and build optimized static assets ----
FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies (locked to package-lock.json). The BuildKit cache
# mount keeps npm's download cache across redeploys, so `npm ci` only
# re-downloads packages that actually changed instead of the whole tree.
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

# VITE_* env vars are inlined by Vite at build time. Env files (.env*) are
# excluded from the image via .dockerignore, so expose the API base URL as an
# explicit build arg instead of baking secrets/machine-specific files in.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# Copy sources and build the production bundle.
# `npm run build` == `tsc -b && vite build`: the same production code
# (TypeScript validation + Vite bundling) runs locally and in the image.
COPY . .
RUN npm run build

# ---- Runtime stage: serve static files only (reverse proxy handles /api) ----
FROM nginx:1.29-alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy minimal static-server config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets
COPY --from=build /app/dist /usr/share/nginx/html

# Create non-root user for security
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup && \
    chown -R appuser:appgroup /usr/share/nginx/html && \
    chown -R appuser:appgroup /var/cache/nginx && \
    chown -R appuser:appgroup /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown appuser:appgroup /var/run/nginx.pid

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:80/ || exit 1

EXPOSE 80

# Switch to non-root user
USER appuser

CMD ["nginx", "-g", "daemon off;"]
