#!/usr/bin/env bash
# RouteFluxMap - Cloudflare Pages Deploy Script
# ==============================================
# Builds the static site and deploys to Cloudflare Pages via Wrangler.
# Similar to allium-deploy pattern - full local control over builds.
#
# Usage:
#   ./deploy/scripts/pages-deploy.sh           # Build and deploy
#   ./deploy/scripts/pages-deploy.sh --dry-run # Build only, show what would deploy
#   ./deploy/scripts/pages-deploy.sh --skip-build # Deploy existing dist/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$DEPLOY_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; }

# Parse arguments
DRY_RUN=false
SKIP_BUILD=false

for arg in "$@"; do
    case $arg in
        --dry-run)
            DRY_RUN=true
            ;;
        --skip-build)
            SKIP_BUILD=true
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --dry-run     Build only, don't deploy"
            echo "  --skip-build  Deploy existing dist/ without rebuilding"
            echo "  --help        Show this help"
            exit 0
            ;;
    esac
done

# Load configuration
CONFIG_FILE="$DEPLOY_DIR/config.env"
if [[ ! -f "$CONFIG_FILE" ]]; then
    error "config.env not found at $CONFIG_FILE"
    echo "  Copy config.env.template to config.env and configure it:"
    echo "  cp $DEPLOY_DIR/config.env.template $DEPLOY_DIR/config.env"
    exit 1
fi

source "$CONFIG_FILE"

# Validate required config
if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]] || [[ "$CLOUDFLARE_ACCOUNT_ID" == "your_account_id_here" ]]; then
    error "CLOUDFLARE_ACCOUNT_ID not configured in config.env"
    exit 1
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]] || [[ "$CLOUDFLARE_API_TOKEN" == "your_api_token_here" ]]; then
    error "CLOUDFLARE_API_TOKEN not configured in config.env"
    exit 1
fi

CF_PAGES_PROJECT="${CF_PAGES_PROJECT:-routefluxmap}"
CF_PAGES_BRANCH="${CF_PAGES_BRANCH:-main}"
PUBLIC_SITE_URL="${PUBLIC_SITE_URL:-}"
PUBLIC_METRICS_URL="${PUBLIC_METRICS_URL:-}"

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
                # R2 requires custom domain for public access
                error "R2_CUSTOM_DOMAIN must be set for R2 public access"
                exit 1
            fi
            ;;
        *)
            error "Unknown storage: $storage"
            exit 1
            ;;
    esac
}

# Parse STORAGE_ORDER to get primary and fallback
STORAGE_ORDER="${STORAGE_ORDER:-do,r2}"
IFS=',' read -ra STORAGE_ARRAY <<< "$STORAGE_ORDER"
PRIMARY_STORAGE="${STORAGE_ARRAY[0]}"
FALLBACK_STORAGE="${STORAGE_ARRAY[1]:-}"

PUBLIC_DATA_URL=$(get_storage_url "$PRIMARY_STORAGE")
if [[ -n "$FALLBACK_STORAGE" ]]; then
    PUBLIC_DATA_URL_FALLBACK=$(get_storage_url "$FALLBACK_STORAGE")
else
    PUBLIC_DATA_URL_FALLBACK=""
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║  RouteFluxMap - Cloudflare Pages Deploy                       ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
log "Project:   $CF_PAGES_PROJECT"
log "Branch:    $CF_PAGES_BRANCH"
log "Storage:   $STORAGE_ORDER (${PRIMARY_STORAGE} primary)"
log "Data URL:  $PUBLIC_DATA_URL"
if [[ -n "$PUBLIC_DATA_URL_FALLBACK" ]]; then
    log "Fallback:  $PUBLIC_DATA_URL_FALLBACK"
fi
log "Dry run:   $DRY_RUN"
echo ""

cd "$PROJECT_DIR"

# Step 1: Build (unless skipped)
if [[ "$SKIP_BUILD" == "false" ]]; then
    log "Building static site..."
    
    # Set environment variables for build (PUBLIC_* are baked into static site)
    export PUBLIC_DATA_URL
    export PUBLIC_DATA_URL_FALLBACK
    export PUBLIC_SITE_URL
    export PUBLIC_METRICS_URL
    
    if npm run build; then
        success "Build completed"
    else
        error "Build failed"
        exit 1
    fi
else
    warn "Skipping build (--skip-build)"
    if [[ ! -d "$PROJECT_DIR/dist" ]]; then
        error "dist/ directory not found. Run build first or remove --skip-build"
        exit 1
    fi
fi

# Step 2: Copy custom files to dist/
log "Adding custom routing files..."

# Copy _headers if exists
if [[ -f "$DEPLOY_DIR/pages/_headers" ]]; then
    cp "$DEPLOY_DIR/pages/_headers" "$PROJECT_DIR/dist/_headers"
    success "Added _headers"
fi

# Copy _redirects if exists
if [[ -f "$DEPLOY_DIR/pages/_redirects" ]]; then
    cp "$DEPLOY_DIR/pages/_redirects" "$PROJECT_DIR/dist/_redirects"
    success "Added _redirects"
fi

# Generate _redirects from template if ENABLE_DATA_PROXY is true
if [[ "${ENABLE_DATA_PROXY:-false}" == "true" ]] && [[ -n "${PUBLIC_DATA_URL:-}" ]]; then
    echo "/data/* ${PUBLIC_DATA_URL}/:splat 200" >> "$PROJECT_DIR/dist/_redirects"
    success "Added data proxy redirect"
fi

# Step 3: Show what will be deployed
log "Deployment contents:"
echo ""
find "$PROJECT_DIR/dist" -maxdepth 2 -type f | head -20
DIST_SIZE=$(du -sh "$PROJECT_DIR/dist" | cut -f1)
echo "..."
echo "Total size: $DIST_SIZE"
echo ""

# Step 4: Deploy (unless dry run)
if [[ "$DRY_RUN" == "true" ]]; then
    warn "Dry run - skipping deploy"
    echo ""
    echo "To deploy, run:"
    echo "  CLOUDFLARE_API_TOKEN=\$CLOUDFLARE_API_TOKEN npx wrangler pages deploy dist \\"
    echo "    --project-name=$CF_PAGES_PROJECT \\"
    echo "    --branch=$CF_PAGES_BRANCH"
    exit 0
fi

log "Deploying to Cloudflare Pages..."
echo ""

# Export token for wrangler
export CLOUDFLARE_API_TOKEN
export CLOUDFLARE_ACCOUNT_ID

# Deploy using wrangler
if npx wrangler pages deploy "$PROJECT_DIR/dist" \
    --project-name="$CF_PAGES_PROJECT" \
    --branch="$CF_PAGES_BRANCH"; then
    echo ""
    success "Deployment complete!"
    echo ""
    echo "  Site URL: https://$CF_PAGES_PROJECT.pages.dev"
    if [[ -n "${CUSTOM_DOMAIN:-}" ]]; then
        echo "  Custom:   https://$CUSTOM_DOMAIN"
    fi
else
    error "Deployment failed"
    exit 1
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║  ✓ Deploy Complete                                            ║"
echo "╚═══════════════════════════════════════════════════════════════╝"

