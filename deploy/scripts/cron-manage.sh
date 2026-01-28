#!/bin/bash
# Cron management - uses /etc/cron.d/ to prevent overwrites
# Usage: ./cron-manage.sh {install|verify|backup|show|migrate}
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; DIM='\033[2m'; NC='\033[0m'
log() { echo -e "${BLUE}[cron]${NC} $1"; }
ok() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err() { echo -e "${RED}✗${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(dirname "$SCRIPT_DIR")"
CRON_USER="${SUDO_USER:-${USER:-$(stat -c '%U' "$DEPLOY_DIR")}}"
CRON_D_FILE="/etc/cron.d/routefluxmap"
BACKUP_DIR="$DEPLOY_DIR/backups/cron"
LOG_FILE="$DEPLOY_DIR/logs/update.log"
mkdir -p "$BACKUP_DIR" "$DEPLOY_DIR/logs"

gen_content() {
    export DEPLOY_DIR CRON_USER
    [[ -f "$DEPLOY_DIR/configs/routefluxmap.cron.d" ]] && \
        envsubst '${DEPLOY_DIR} ${CRON_USER}' < "$DEPLOY_DIR/configs/routefluxmap.cron.d" && return
    cat << EOF
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
MAILTO=""
0 */4 * * * ${CRON_USER} ${DEPLOY_DIR}/scripts/update.sh >> ${DEPLOY_DIR}/logs/update.log 2>&1
EOF
}

cmd_install() {
    log "Installing cron jobs to /etc/cron.d/..."
    if [[ $EUID -ne 0 ]]; then
        err "Requires sudo: sudo $0 install"; exit 1
    fi
    gen_content > "$CRON_D_FILE"
    chmod 644 "$CRON_D_FILE"; chown root:root "$CRON_D_FILE"
    ok "Installed: $CRON_D_FILE"
    echo ""
    cat "$CRON_D_FILE"
    echo ""
    ok "Cron job will run every 4 hours at :00"
}

cmd_verify() {
    log "Verifying cron jobs..."; echo ""
    local found_crond=false found_user=false exit_code=0
    
    # Check /etc/cron.d/
    if [[ -f "$CRON_D_FILE" ]] && grep -q "update.sh" "$CRON_D_FILE" 2>/dev/null; then
        ok "/etc/cron.d/routefluxmap: update job ✓"
        found_crond=true
    else
        warn "/etc/cron.d/routefluxmap: not found"
    fi
    
    # Check user crontab
    local user_cron; user_cron=$(crontab -l 2>/dev/null || true)
    if echo "$user_cron" | grep -q "routefluxmap.*update"; then
        [[ "$found_crond" == "true" ]] && warn "User crontab: DUPLICATE (run migrate)" || ok "User crontab: update ✓"
        found_user=true
    fi
    
    # Check cron service
    echo ""
    if systemctl is-active --quiet cron 2>/dev/null || systemctl is-active --quiet crond 2>/dev/null || pgrep -x cron &>/dev/null; then
        ok "Cron service: running"
    else
        err "Cron service: NOT running"
        exit_code=1
    fi
    
    # Show recent activity
    if [[ -f "$LOG_FILE" ]]; then
        local last_run; last_run=$(grep -E '^\[' "$LOG_FILE" 2>/dev/null | tail -1 | grep -oE '\[[0-9-]+ [0-9:]+\]' | tr -d '[]' || echo "")
        [[ -n "$last_run" ]] && echo -e "Last run: ${GREEN}$last_run${NC}"
    fi
    
    echo ""
    if [[ "$found_crond" == "true" ]]; then
        ok "Status: Cron jobs in /etc/cron.d/ (protected)"
        [[ "$found_user" == "true" ]] && warn "Run '$0 migrate' to remove duplicates"
    elif [[ "$found_user" == "true" ]]; then
        warn "Status: User crontab only (vulnerable). Run 'sudo $0 install'"
        exit_code=1
    else
        err "NO CRON JOBS FOUND! Run 'sudo $0 install'"
        exit_code=1
    fi
    
    return $exit_code
}

cmd_backup() {
    local f="$BACKUP_DIR/crontab-$(date +%Y%m%d_%H%M%S).bak"
    crontab -l > "$f" 2>/dev/null && [[ -s "$f" ]] && ok "Backed up: $f" || { rm -f "$f"; warn "Nothing to backup"; }
}

cmd_show() {
    log "Current configuration:"; echo ""
    echo "=== /etc/cron.d/routefluxmap ===" 
    [[ -f "$CRON_D_FILE" ]] && cat "$CRON_D_FILE" || echo "(not found)"
    echo ""
    echo "=== User crontab (routefluxmap entries) ==="
    crontab -l 2>/dev/null | grep -E "routefluxmap" || echo "(none)"
    echo ""
    echo "=== Recent log entries ==="
    if [[ -f "$LOG_FILE" ]]; then
        tail -10 "$LOG_FILE"
    else
        echo "(no log file yet)"
    fi
    echo ""
    echo "=== Backups ===" 
    ls -1 "$BACKUP_DIR"/*.bak 2>/dev/null | tail -5 || echo "(none)"
}

cmd_migrate() {
    log "Migrating to /etc/cron.d/..."; echo ""
    [[ -f "$CRON_D_FILE" ]] || { err "Run 'sudo $0 install' first"; exit 1; }
    local cur; cur=$(crontab -l 2>/dev/null || true)
    [[ -z "$cur" ]] && { ok "User crontab empty"; return 0; }
    local cnt; cnt=$(echo "$cur" | grep -cE "routefluxmap" || echo 0)
    [[ "$cnt" -eq 0 ]] && { ok "No routefluxmap entries to migrate"; return 0; }
    # Backup then remove
    local f="$BACKUP_DIR/crontab-$(date +%Y%m%d_%H%M%S).bak"
    echo "$cur" > "$f"; ok "Backed up: $f"
    local new; new=$(echo "$cur" | grep -vE "routefluxmap" || true)
    [[ -n "$new" ]] && echo "$new" | crontab - || crontab -r 2>/dev/null
    ok "Removed $cnt entries from user crontab"
}

cmd_remove() {
    log "Removing cron jobs..."
    if [[ $EUID -ne 0 ]]; then
        err "Requires sudo: sudo $0 remove"; exit 1
    fi
    if [[ -f "$CRON_D_FILE" ]]; then
        rm "$CRON_D_FILE"
        ok "Removed: $CRON_D_FILE"
    else
        warn "File not found: $CRON_D_FILE"
    fi
}

case "${1:-}" in
    install) cmd_install ;;
    verify) cmd_verify ;;
    backup) cmd_backup ;;
    show) cmd_show ;;
    migrate) cmd_migrate ;;
    remove) cmd_remove ;;
    *)
        echo "RouteFluxMap Cron Management"
        echo ""
        echo "Usage: $0 {install|verify|backup|show|migrate|remove}"
        echo ""
        echo "Commands:"
        echo "  install   Install cron jobs to /etc/cron.d/ (requires sudo)"
        echo "  verify    Check if cron jobs are installed (returns exit code)"
        echo "  backup    Backup current user crontab"
        echo "  show      Show all cron configuration and recent logs"
        echo "  migrate   Move entries from user crontab to /etc/cron.d/"
        echo "  remove    Remove cron jobs from /etc/cron.d/ (requires sudo)"
        exit 1
        ;;
esac
