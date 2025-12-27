#!/usr/bin/env bash
# RouteFluxMap - Cloudflare Pages Deploy Script
# ==============================================
# Builds the static site and deploys to Cloudflare Pages via Wrangler.
# Uses Pages Functions to proxy /data/* requests to R2 (native) or DO Spaces (HTTP).
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
STORAGE_ORDER="${STORAGE_ORDER:-do,r2}"

# === Generate wrangler.toml from template ===

TEMPLATE_FILE="$PROJECT_DIR/wrangler.toml.template"
WRANGLER_FILE="$PROJECT_DIR/wrangler.toml"

if [[ -f "$TEMPLATE_FILE" ]]; then
    log "Generating wrangler.toml from template..."
    
    # Build R2 bucket section
    R2_BUCKET_SECTION=""
    if [[ "${R2_ENABLED:-false}" == "true" ]] && [[ -n "${R2_BUCKET:-}" ]]; then
        R2_BUCKET_SECTION="[[r2_buckets]]
binding = \"DATA_BUCKET\"
bucket_name = \"${R2_BUCKET}\""
    else
        R2_BUCKET_SECTION="# R2 disabled (R2_ENABLED=false or R2_BUCKET not set)"
    fi
    
    # Build DO Spaces URL var
    DO_SPACES_URL_VAR=""
    if [[ "${DO_ENABLED:-false}" == "true" ]]; then
        if [[ -n "${DO_SPACES_CUSTOM_DOMAIN:-}" ]]; then
            DO_SPACES_URL="https://${DO_SPACES_CUSTOM_DOMAIN}"
        elif [[ "${DO_SPACES_CDN:-false}" == "true" ]]; then
            DO_SPACES_URL="https://${DO_SPACES_BUCKET}.${DO_SPACES_REGION}.cdn.digitaloceanspaces.com"
        else
            DO_SPACES_URL="https://${DO_SPACES_BUCKET}.${DO_SPACES_REGION}.digitaloceanspaces.com"
        fi
        DO_SPACES_URL_VAR="DO_SPACES_URL = \"${DO_SPACES_URL}\""
    else
        DO_SPACES_URL_VAR="# DO_SPACES_URL not configured (DO_ENABLED=false)"
    fi
    
    # Generate wrangler.toml
    ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-}"
    sed -e "s|{{CF_PAGES_PROJECT}}|${CF_PAGES_PROJECT}|g" \
        -e "s|{{STORAGE_ORDER}}|${STORAGE_ORDER}|g" \
        -e "s|{{ALLOWED_ORIGINS}}|${ALLOWED_ORIGINS}|g" \
        "$TEMPLATE_FILE" > "$WRANGLER_FILE.tmp"
    
    # Replace multi-line sections
    awk -v r2_section="$R2_BUCKET_SECTION" -v do_section="$DO_SPACES_URL_VAR" '
        /\{\{R2_BUCKET_SECTION\}\}/ { print r2_section; next }
        /\{\{DO_SPACES_URL_VAR\}\}/ { print do_section; next }
        { print }
    ' "$WRANGLER_FILE.tmp" > "$WRANGLER_FILE"
    rm -f "$WRANGLER_FILE.tmp"
    
    success "Generated wrangler.toml"
else
    warn "wrangler.toml.template not found, skipping generation"
fi

# Data is served via Pages Function at /data/*
# Frontend fetches from relative URL /data/
PUBLIC_DATA_URL="/data"

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║  RouteFluxMap - Cloudflare Pages Deploy                       ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
log "Project:      $CF_PAGES_PROJECT"
log "Branch:       $CF_PAGES_BRANCH"
log "Storage:      $STORAGE_ORDER"
log "Data URL:     $PUBLIC_DATA_URL (via Pages Function)"
log "Dry run:      $DRY_RUN"
echo ""

# Display storage backends
log "Storage Backends:"
IFS=',' read -ra STORAGE_ARRAY <<< "$STORAGE_ORDER"
for backend in "${STORAGE_ARRAY[@]}"; do
    backend=$(echo "$backend" | tr -d ' ')
    case "$backend" in
        do)
            if [[ "${DO_ENABLED:-false}" == "true" ]]; then
                echo "   • DO Spaces: ✅ ${DO_SPACES_BUCKET}.${DO_SPACES_REGION}.digitaloceanspaces.com"
            else
                echo "   • DO Spaces: ⚠️  In order but DO_ENABLED=false"
            fi
            ;;
        r2)
            if [[ "${R2_ENABLED:-false}" == "true" ]]; then
                echo "   • R2:        ✅ ${R2_BUCKET} (native binding)"
            else
                echo "   • R2:        ⚠️  In order but R2_ENABLED=false"
            fi
            ;;
    esac
done
echo ""

cd "$PROJECT_DIR"

# Step 1: Build (unless skipped)
if [[ "$SKIP_BUILD" == "false" ]]; then
    log "Building static site..."
    
    # Set environment variables for build (PUBLIC_* are baked into static site)
    export PUBLIC_DATA_URL
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

# Remove data from dist (data is served via Pages Function from R2/DO, not from dist)
if [[ -d "$PROJECT_DIR/dist/data" ]]; then
    rm -rf "$PROJECT_DIR/dist/data"
    success "Removed dist/data (data served from R2/DO via Pages Function)"
fi

# Step 2: Copy custom files to dist/
log "Adding custom routing files..."

# Copy _headers if exists
if [[ -f "$DEPLOY_DIR/pages/_headers" ]]; then
    cp "$DEPLOY_DIR/pages/_headers" "$PROJECT_DIR/dist/_headers"
    success "Added _headers"
fi

# Copy _redirects if exists (but we don't need data proxy anymore - Pages Function handles it)
if [[ -f "$DEPLOY_DIR/pages/_redirects" ]]; then
    # Filter out any /data/* redirects since Pages Function handles that now
    grep -v "^/data/\*" "$DEPLOY_DIR/pages/_redirects" > "$PROJECT_DIR/dist/_redirects" 2>/dev/null || true
    success "Added _redirects"
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

# Deploy using wrangler (includes functions/ directory automatically)
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
    echo ""
    echo "  Data is served via Pages Function at /data/*"
    echo "  Check X-Served-From header to see which backend served a request"
else
    error "Deployment failed"
    exit 1
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║  ✓ Deploy Complete                                            ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
