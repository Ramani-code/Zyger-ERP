#!/usr/bin/env bash
# =====================================================================
# Zyger ERP — Staging Deployment Script
#
# Safe, non-destructive deployment of the staging Docker stack.
# - Never deletes persistent volumes
# - Validates environment and tooling before acting
# - Waits for PostgreSQL and backend health
# - Prints diagnostics on failure
# =====================================================================
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_ROOT/docker-compose.staging.yml"
ENV_FILE="$PROJECT_ROOT/.env.staging"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'

cd "$PROJECT_ROOT"

echo -e "${GREEN}=== Zyger ERP — Staging Deployment ===${NC}"

# ---------- 1. Docker availability ----------
if ! command -v docker &> /dev/null; then
    echo -e "${RED}ERROR: Docker is not installed.${NC}" >&2; exit 1
fi
if ! docker compose version &> /dev/null; then
    echo -e "${RED}ERROR: Docker Compose v2 is not installed.${NC}" >&2; exit 1
fi

# ---------- 2. Environment file exists ----------
if [ ! -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}WARNING: $ENV_FILE not found.${NC}"
    echo "Copy the template and fill in real values:"
    echo "  cp .env.staging.example .env.staging"
    echo "  Then edit .env.staging (JWT_SECRET, POSTGRES_PASSWORD, CORS_ALLOWED_ORIGINS, ...)"
    exit 1
fi

# ---------- 3. Import environment and validate required vars ----------
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

REQUIRED_VARS=(POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD JWT_SECRET HIDDEN_ADMIN_PASSWORD SPRING_PROFILES_ACTIVE)
MISSING=0
for v in "${REQUIRED_VARS[@]}"; do
    val="${!v:-}"
    if [ -z "$val" ]; then
        echo -e "${RED}ERROR: Missing required env var: $v${NC}" >&2; MISSING=1
    fi
done

for v in POSTGRES_PASSWORD JWT_SECRET HIDDEN_ADMIN_PASSWORD; do
    val="${!v:-}"
    if [[ "$val" == *CHANGE_ME* || "$val" == *change-me* || "$val" == *placeholder* ]]; then
        echo -e "${RED}ERROR: $v still contains a placeholder. Set a real secret.${NC}" >&2; MISSING=1
    fi
done

if [ "$MISSING" -ne 0 ]; then
    echo -e "${RED}Fix the environment file above and re-run. No changes were made.${NC}" >&2
    exit 1
fi

# ---------- 4. Build & start the stack (NEVER -v) ----------
echo -e "${GREEN}Building and starting staging stack...${NC}"
# BuildKit enables the cache mounts in the Dockerfiles (npm/gradle caches),
# which is what makes redeploys fast instead of re-fetching every dependency.
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build

# ---------- 5. Wait for PostgreSQL ----------
echo "Waiting for PostgreSQL to become healthy..."
for i in $(seq 1 60); do
    state="$(docker inspect -f '{{.State.Health.Status}}' zyger-staging-postgres 2>/dev/null || echo 'not_created')"
    if [ "$state" = "healthy" ]; then
        echo -e "${GREEN}PostgreSQL healthy${NC}"; break
    fi
    if [ "$i" -eq 60 ]; then
        echo -e "${RED}ERROR: PostgreSQL did not become healthy in time.${NC}" >&2
        docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=50 postgres >&2 || true
        exit 1
    fi
    sleep 2
done

# ---------- 6. Wait for backend health ----------
echo "Waiting for backend to become healthy..."
for i in $(seq 1 120); do
    state="$(docker inspect -f '{{.State.Health.Status}}' zyger-staging-backend 2>/dev/null || echo 'not_created')"
    if [ "$state" = "healthy" ]; then
        echo -e "${GREEN}Backend healthy${NC}"; break
    fi
    if [ "$i" -eq 120 ]; then
        echo -e "${RED}ERROR: Backend did not become healthy in time.${NC}" >&2
        docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=80 backend >&2 || true
        exit 1
    fi
    sleep 3
done

# ---------- 7. Status ----------
echo -e "${GREEN}=== Deployment complete — service status: ===${NC}"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps

echo -e "${GREEN}Staging is available at: http://localhost:${NGINX_PORT:-80}${NC}"
echo -e "${YELLOW}Run ./scripts/health-check.sh for full verification.${NC}"
