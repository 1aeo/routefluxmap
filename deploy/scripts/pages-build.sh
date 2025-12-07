#!/usr/bin/env bash
# RouteFluxMap - Build Script
# ============================
# Builds the static site with proper environment configuration.
# Wrapper around npm run build with config loading.
#
# Usage:
#   ./deploy/scripts/pages-build.sh              # Build with config.env
#   ./deploy/scripts/pages-build.sh --typecheck  # Include TypeScript check

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$DEPLOY_DIR")"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }

# Parse arguments
TYPECHECK=false
for arg in "$@"; do
    case $arg in
        --typecheck)
            TYPECHECK=true
            ;;
    esac
done

# Load configuration
CONFIG_FILE="$DEPLOY_DIR/config.env"
if [[ -f "$CONFIG_FILE" ]]; then
    source "$CONFIG_FILE"
    log "Loaded config from $CONFIG_FILE"
else
    log "Warning: config.env not found, using environment variables"
fi

# Build data URLs from storage config
get_storage_url() {
    local storage="$1"
    case "$storage" in
        do)
            if [[ -n "${DO_SPACES_CUSTOM_DOMAIN:-}" ]]; then
                echo "https://${DO_SPACES_CUSTOM_DOMAIN}"
            elif [[ "${DO_SPACES_CDN:-false}" == "true" ]]; then
                echo "https://${DO_SPACES_BUCKET}.${DO_SPACES_REGION}.cdn.digitaloceanspaces.com"
            else
                echo "https://${DO_SPACES_BUCKET}.${DO_SPACES_REGION}.digitaloceanspaces.com"
            fi
            ;;
        r2)
            if [[ -n "${R2_CUSTOM_DOMAIN:-}" ]]; then
                echo "https://${R2_CUSTOM_DOMAIN}"
            else
                echo ""  # R2 requires custom domain
            fi
            ;;
    esac
}

# Parse STORAGE_ORDER to get primary and fallback
STORAGE_ORDER="${STORAGE_ORDER:-do,r2}"
IFS=',' read -ra STORAGE_ARRAY <<< "$STORAGE_ORDER"
PRIMARY_STORAGE="${STORAGE_ARRAY[0]}"
FALLBACK_STORAGE="${STORAGE_ARRAY[1]:-}"

export PUBLIC_DATA_URL=$(get_storage_url "$PRIMARY_STORAGE")
if [[ -n "$FALLBACK_STORAGE" ]]; then
    export PUBLIC_DATA_URL_FALLBACK=$(get_storage_url "$FALLBACK_STORAGE")
else
    export PUBLIC_DATA_URL_FALLBACK=""
fi
export PUBLIC_SITE_URL="${PUBLIC_SITE_URL:-}"
export PUBLIC_METRICS_URL="${PUBLIC_METRICS_URL:-}"

log "Building with:"
log "  STORAGE ORDER:   $STORAGE_ORDER"
log "  DATA (primary):  $PUBLIC_DATA_URL"
log "  DATA (fallback): ${PUBLIC_DATA_URL_FALLBACK:-'(none)'}"
log "  SITE URL:        ${PUBLIC_SITE_URL:-'(not set)'}"
log "  METRICS URL:     ${PUBLIC_METRICS_URL:-'(not set)'}"

cd "$PROJECT_DIR"

# Install dependencies if needed
if [[ ! -d "node_modules" ]]; then
    log "Installing dependencies..."
    npm install
fi

# Run build
if [[ "$TYPECHECK" == "true" ]]; then
    log "Running TypeScript check..."
    npm run typecheck
fi

log "Building static site..."
npm run build

success "Build complete! Output in dist/"
echo ""
echo "Contents:"
ls -la dist/

