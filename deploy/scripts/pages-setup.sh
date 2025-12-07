#!/usr/bin/env bash
# RouteFluxMap - Pages Deploy Setup Script
# =========================================
# One-time setup for a new deploy server.
# Installs dependencies and configures the environment.
#
# Usage:
#   ./deploy/scripts/pages-setup.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$DEPLOY_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${BLUE}[$(date '+%H:%M:%S')]${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; }

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║  RouteFluxMap - Pages Deploy Setup                            ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

cd "$PROJECT_DIR"

# Step 1: Check Node.js
log "Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    success "Node.js $NODE_VERSION"
else
    error "Node.js not found. Install Node.js 20+ first."
    echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    echo "  sudo apt-get install -y nodejs"
    exit 1
fi

# Check Node version >= 20
NODE_MAJOR=$(node --version | cut -d. -f1 | tr -d 'v')
if [[ "$NODE_MAJOR" -lt 20 ]]; then
    warn "Node.js version $NODE_VERSION is older than recommended (20+)"
fi

# Step 2: Install npm dependencies
log "Installing npm dependencies..."
npm install
success "Dependencies installed"

# Step 3: Check for wrangler
log "Checking wrangler..."
if npx wrangler --version &> /dev/null; then
    WRANGLER_VERSION=$(npx wrangler --version 2>/dev/null | head -1)
    success "Wrangler available: $WRANGLER_VERSION"
else
    warn "Installing wrangler..."
    npm install -D wrangler
    success "Wrangler installed"
fi

# Step 4: Create config.env if not exists
if [[ ! -f "$DEPLOY_DIR/config.env" ]]; then
    log "Creating config.env from template..."
    cp "$DEPLOY_DIR/config.env.template" "$DEPLOY_DIR/config.env"
    success "Created config.env"
    echo ""
    warn "⚠️  You need to edit deploy/config.env with your Cloudflare credentials!"
    echo ""
    echo "Required settings for Pages deploy:"
    echo "  - CLOUDFLARE_ACCOUNT_ID: Your Cloudflare account ID"
    echo "  - CLOUDFLARE_API_TOKEN: API token with Pages Edit permission"
    echo ""
    echo "Edit the config:"
    echo "  nano $DEPLOY_DIR/config.env"
else
    success "config.env already exists"
fi

# Step 5: Ensure pages directory exists
mkdir -p "$DEPLOY_DIR/pages"
success "Ensured pages directory exists"

# Step 6: Test build
echo ""
log "Testing build..."
if npm run build; then
    success "Test build successful!"
else
    error "Test build failed. Check for errors above."
    exit 1
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║  ✓ Setup Complete                                             ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo ""
echo "  1. Edit deploy/config.env with your Cloudflare credentials"
echo ""
echo "  2. (Optional) Add custom routing files:"
echo "     - deploy/pages/_headers  (custom HTTP headers)"
echo "     - deploy/pages/_redirects (URL redirects/rewrites)"
echo ""
echo "  3. Deploy:"
echo "     ./deploy/scripts/pages-deploy.sh"
echo ""
echo "  4. (Optional) Login to wrangler for interactive use:"
echo "     npx wrangler login"
echo ""

