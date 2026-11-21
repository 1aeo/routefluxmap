#!/usr/bin/env bash
# Behavior tests for RouteFluxMap deploy backup coordination, pruning,
# monthly archival, log rotation, and error propagation.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP_DIR="$(mktemp -d /tmp/routefluxmap-backup-test.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
    echo "not ok - $1" >&2
    if [[ -n "${LAST_RUN_LOG:-}" && -f "$LAST_RUN_LOG" ]]; then
        sed 's/^/#   /' "$LAST_RUN_LOG" >&2
    fi
    exit 1
}

pass() {
    echo "ok - $1"
}

setup_deploy_copy() {
    local dst="$1"
    rm -rf "$dst"
    mkdir -p "$dst/deploy/scripts" "$dst/deploy/configs" "$dst/deploy/logs" "$dst/public/data" "$dst/backups"
    cp "$ROOT_DIR/deploy/scripts/"*.sh "$dst/deploy/scripts/"
    chmod +x "$dst/deploy/scripts/"*.sh
    cp "$ROOT_DIR/deploy/configs/routefluxmap.cron.d" "$dst/deploy/configs/"
    printf '{"dates":["2026-11-21"]}\n' > "$dst/public/data/index.json"
}

MOCK_BIN="$TMP_DIR/mock-bin"
mkdir -p "$MOCK_BIN"

cat > "$MOCK_BIN/rclone" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${MOCK_RCLONE_CALLS:?MOCK_RCLONE_CALLS must be set}"
case "${1:-}" in
    listremotes)
        printf 'r2-rfm:\nspaces-rfm:\n'
        ;;
    sync)
        src="${2:-}"
        dst="${3:-}"
        if [[ -n "${MOCK_FAIL_LOCAL_BACKUP:-}" && "$dst" == */.tmp-backup-* ]]; then
            mkdir -p "$dst"
            echo "mock local backup failure" >&2
            exit 7
        fi
        if [[ -n "${MOCK_FAIL_REMOTE_BACKUP:-}" && "$dst" == *:_backups/* ]]; then
            echo "mock remote backup failure" >&2
            exit 8
        fi
        if [[ -n "${MOCK_FAIL_UPLOAD:-}" && "$dst" != */.tmp-backup-* && "$dst" != *:_backups/* ]]; then
            echo "mock upload failure" >&2
            exit 9
        fi
        if [[ "$dst" == */.tmp-backup-* ]]; then
            mkdir -p "$dst"
            printf '{"snapshot":true}\n' > "$dst/index.json"
        fi
        ;;
esac
EOF
chmod +x "$MOCK_BIN/rclone"

cat > "$MOCK_BIN/node" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
    echo "v20.19.6"
fi
exit 0
EOF
chmod +x "$MOCK_BIN/node"

cat > "$MOCK_BIN/npx" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$MOCK_BIN/npx"

# Always provide deterministic flock stub (contends when MOCK_FLOCK_CONTEND=1)
MOCK_FLOCK_BIN="$TMP_DIR/mock-flock-bin"
mkdir -p "$MOCK_FLOCK_BIN"
cat > "$MOCK_FLOCK_BIN/flock" <<'EOF'
#!/usr/bin/env bash
if [[ "${MOCK_FLOCK_CONTEND:-0}" == "1" ]]; then
    exit 1
fi
exit 0
EOF
chmod +x "$MOCK_FLOCK_BIN/flock"

TODAY=$(date '+%Y-%m-%d')
CUR_YM=$(date '+%Y-%m')
PREV_YM=$(python3 -c 'import datetime; d=datetime.date.today().replace(day=1)-datetime.timedelta(days=1); print(d.strftime("%Y-%m"))')
PREV_MM_YY=$(python3 -c 'import datetime; d=datetime.date.today().replace(day=1)-datetime.timedelta(days=1); print(d.strftime("%m/%y"))')

# ---------------------------------------------------------------------------
# Test 1: update.sh with R2 + DO takes only 1 local backup (from R2) & prunes
# ---------------------------------------------------------------------------
PROJ1="$TMP_DIR/proj1"
setup_deploy_copy "$PROJ1"
CALLS1="$TMP_DIR/calls1.log"
LAST_RUN_LOG="$TMP_DIR/run1.log"
cat > "$PROJ1/deploy/config.env" <<EOF
R2_ENABLED=true
DO_ENABLED=true
R2_BUCKET=test-r2-bucket
R2_ACCESS_KEY_ID=k
R2_SECRET_ACCESS_KEY=s
CLOUDFLARE_ACCOUNT_ID=acc
DO_SPACES_BUCKET=test-do-bucket
DO_SPACES_KEY=dk
DO_SPACES_SECRET=ds
DO_SPACES_REGION=nyc3
OUTPUT_DIR=$PROJ1/public/data
BACKUP_DIR=$PROJ1/backups
RCLONE_PATH=$MOCK_BIN/rclone
KEEP_BACKUPS=2
EOF

# Seed 3 existing current-month backups so --prune-only at end of update.sh trims them
for d in 01 02 03; do
    mkdir -p "$PROJ1/backups/backup-${CUR_YM}-${d}_000100"
done

: > "$CALLS1"
PATH="$MOCK_BIN:$MOCK_FLOCK_BIN:$PATH" MOCK_RCLONE_CALLS="$CALLS1" \
    "$PROJ1/deploy/scripts/update.sh" > "$LAST_RUN_LOG" 2>&1

local_calls=$(grep -c '/.tmp-backup-' "$CALLS1" || true)
r2_local_calls=$(grep -c 'sync r2-rfm:test-r2-bucket .*/.tmp-backup-' "$CALLS1" || true)
do_local_calls=$(grep -c 'sync spaces-rfm:test-do-bucket .*/.tmp-backup-' "$CALLS1" || true)
remote_calls=$(grep -c '/_backups/' "$CALLS1" || true)
[[ "$local_calls" == "1" && "$r2_local_calls" == "1" && "$do_local_calls" == "0" ]] || \
    fail "expected 1 local backup (from R2 only), got local=$local_calls r2=$r2_local_calls do=$do_local_calls"
[[ "$remote_calls" == "2" ]] || fail "expected 2 remote backups, got $remote_calls"
[[ -f "$PROJ1/deploy/logs/last-local-backup-date" && "$(cat "$PROJ1/deploy/logs/last-local-backup-date")" == "$TODAY" ]] || \
    fail "shared last-local-backup-date marker was not written"
[[ ! -e "$PROJ1/deploy/logs/last-do-local-backup-date" ]] || \
    fail "legacy last-do-local-backup-date should not be written"
cur_count=$(find "$PROJ1/backups" -maxdepth 1 -type d -name "backup-${CUR_YM}-*" | wc -l | tr -d ' ')
[[ "$cur_count" == "2" ]] || fail "expected update.sh --prune-only to keep 2 backups, got $cur_count"
pass "update.sh takes single local backup (R2 only) and enforces KEEP_BACKUPS daily"

# ---------------------------------------------------------------------------
# Test 2: update.sh with R2 disabled lets DO take the local backup
# ---------------------------------------------------------------------------
PROJ2="$TMP_DIR/proj2"
setup_deploy_copy "$PROJ2"
CALLS2="$TMP_DIR/calls2.log"
LAST_RUN_LOG="$TMP_DIR/run2.log"
cat > "$PROJ2/deploy/config.env" <<EOF
R2_ENABLED=false
DO_ENABLED=true
DO_SPACES_BUCKET=test-do-bucket
DO_SPACES_KEY=dk
DO_SPACES_SECRET=ds
DO_SPACES_REGION=nyc3
OUTPUT_DIR=$PROJ2/public/data
BACKUP_DIR=$PROJ2/backups
RCLONE_PATH=$MOCK_BIN/rclone
EOF

: > "$CALLS2"
PATH="$MOCK_BIN:$MOCK_FLOCK_BIN:$PATH" MOCK_RCLONE_CALLS="$CALLS2" \
    "$PROJ2/deploy/scripts/update.sh" > "$LAST_RUN_LOG" 2>&1

do_local_calls=$(grep -c 'sync spaces-rfm:test-do-bucket .*/.tmp-backup-' "$CALLS2" || true)
[[ "$do_local_calls" == "1" ]] || fail "expected DO-only run to create 1 local backup, got $do_local_calls"
pass "update.sh with R2 disabled lets DO take local backup"

# ---------------------------------------------------------------------------
# Test 3: Shared marker & flock contention prevent duplicate manual backups
# ---------------------------------------------------------------------------
PROJ3="$TMP_DIR/proj3"
setup_deploy_copy "$PROJ3"
CALLS3="$TMP_DIR/calls3.log"
LAST_RUN_LOG="$TMP_DIR/run3.log"
cat > "$PROJ3/deploy/config.env" <<EOF
R2_ENABLED=true
DO_ENABLED=true
R2_BUCKET=test-r2-bucket
R2_ACCESS_KEY_ID=k
R2_SECRET_ACCESS_KEY=s
CLOUDFLARE_ACCOUNT_ID=acc
DO_SPACES_BUCKET=test-do-bucket
DO_SPACES_KEY=dk
DO_SPACES_SECRET=ds
DO_SPACES_REGION=nyc3
OUTPUT_DIR=$PROJ3/public/data
BACKUP_DIR=$PROJ3/backups
RCLONE_PATH=$MOCK_BIN/rclone
EOF

: > "$CALLS3"
PATH="$MOCK_BIN:$MOCK_FLOCK_BIN:$PATH" MOCK_RCLONE_CALLS="$CALLS3" \
    "$PROJ3/deploy/scripts/upload-r2.sh" "$PROJ3/public/data" > "$LAST_RUN_LOG" 2>&1
PATH="$MOCK_BIN:$MOCK_FLOCK_BIN:$PATH" MOCK_RCLONE_CALLS="$CALLS3" \
    "$PROJ3/deploy/scripts/upload-do.sh" "$PROJ3/public/data" >> "$LAST_RUN_LOG" 2>&1
local_calls=$(grep -c '/.tmp-backup-' "$CALLS3" || true)
[[ "$local_calls" == "1" ]] || fail "sequential R2 then DO created $local_calls local backups instead of 1"

rm -f "$PROJ3/deploy/logs/last-local-backup-date"
: > "$CALLS3"
PATH="$MOCK_FLOCK_BIN:$MOCK_BIN:$PATH" MOCK_FLOCK_CONTEND=1 MOCK_RCLONE_CALLS="$CALLS3" \
    "$PROJ3/deploy/scripts/upload-do.sh" "$PROJ3/public/data" > "$LAST_RUN_LOG" 2>&1
grep -Fq 'another local backup is already in progress' "$LAST_RUN_LOG" || \
    fail "flock contention was not logged"
[[ "$(grep -c '/.tmp-backup-' "$CALLS3" || true)" == "0" ]] || \
    fail "flock contention still ran local backup"
pass "shared marker and flock contention prevent duplicate local backups"

# ---------------------------------------------------------------------------
# Test 4: Failed backups clean staging dir, keep marker unset, and fail upload
# ---------------------------------------------------------------------------
PROJ4="$TMP_DIR/proj4"
setup_deploy_copy "$PROJ4"
CALLS4="$TMP_DIR/calls4.log"
LAST_RUN_LOG="$TMP_DIR/run4.log"
cat > "$PROJ4/deploy/config.env" <<EOF
R2_BUCKET=test-r2-bucket
R2_ACCESS_KEY_ID=k
R2_SECRET_ACCESS_KEY=s
CLOUDFLARE_ACCOUNT_ID=acc
OUTPUT_DIR=$PROJ4/public/data
BACKUP_DIR=$PROJ4/backups
RCLONE_PATH=$MOCK_BIN/rclone
EOF

: > "$CALLS4"
PATH="$MOCK_BIN:$MOCK_FLOCK_BIN:$PATH" MOCK_RCLONE_CALLS="$CALLS4" MOCK_FAIL_LOCAL_BACKUP=1 \
    "$PROJ4/deploy/scripts/upload-r2.sh" "$PROJ4/public/data" > "$LAST_RUN_LOG" 2>&1
[[ ! -e "$PROJ4/deploy/logs/last-local-backup-date" ]] || fail "failed local backup wrote marker"
leftover_tmp=$(find "$PROJ4/backups" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')
[[ "$leftover_tmp" == "0" ]] || fail "failed local backup left staging files behind: $leftover_tmp"

if PATH="$MOCK_BIN:$MOCK_FLOCK_BIN:$PATH" MOCK_RCLONE_CALLS="$CALLS4" MOCK_FAIL_UPLOAD=1 \
    "$PROJ4/deploy/scripts/upload-r2.sh" "$PROJ4/public/data" > "$LAST_RUN_LOG" 2>&1; then
    fail "upload-r2.sh returned 0 despite rclone upload failure"
fi
pass "failed local backup cleans staging dir and upload failure exits non-zero"

# ---------------------------------------------------------------------------
# Test 5: backup-maintenance.sh pruning, space-safe archival, corrupt archive,
#         --prune-only, stale temp cleanup, no duplicate listing, invalid KEEP
# ---------------------------------------------------------------------------
PROJ5="$TMP_DIR/proj5"
setup_deploy_copy "$PROJ5"
LAST_RUN_LOG="$TMP_DIR/run5.log"
cat > "$PROJ5/deploy/config.env" <<EOF
BACKUP_DIR=$PROJ5/backups
KEEP_BACKUPS=2
EOF

# Create stale temp dir and temp archive (>24h old) plus fresh temp (<24h)
mkdir -p "$PROJ5/backups/.tmp-backup-stale" "$PROJ5/backups/.tmp-backup-fresh"
touch -t 202601010000 "$PROJ5/backups/.tmp-backup-stale"
printf 'x' > "$PROJ5/backups/backup-2025-12.tar.gz.tmp.999"
touch -t 202601010000 "$PROJ5/backups/backup-2025-12.tar.gz.tmp.999"

# Seed completed month with 3 daily backups + corrupt existing archive
for d in 01 02 28; do
    mkdir -p "$PROJ5/backups/backup-${PREV_YM}-${d}_000100"
    printf 'day %s\n' "$d" > "$PROJ5/backups/backup-${PREV_YM}-${d}_000100/data.json"
done
printf 'not a valid gzip file\n' > "$PROJ5/backups/backup-${PREV_YM}.tar.gz"

# Seed 4 current-month backups
for d in 01 02 03 04; do
    mkdir -p "$PROJ5/backups/backup-${CUR_YM}-${d}_000100"
    printf 'cur %s\n' "$d" > "$PROJ5/backups/backup-${CUR_YM}-${d}_000100/data.json"
done

# 5a: --prune-only leaves completed-month daily backups and corrupt archive untouched
PATH="$MOCK_FLOCK_BIN:$PATH" "$PROJ5/deploy/scripts/backup-maintenance.sh" --prune-only > "$LAST_RUN_LOG" 2>&1
[[ ! -e "$PROJ5/backups/.tmp-backup-stale" ]] || fail "stale .tmp-backup was not removed"
[[ -d "$PROJ5/backups/.tmp-backup-fresh" ]] || fail "fresh .tmp-backup was removed prematurely"
[[ ! -e "$PROJ5/backups/backup-2025-12.tar.gz.tmp.999" ]] || fail "stale .tar.gz.tmp was not removed"
[[ $(find "$PROJ5/backups" -maxdepth 1 -type d -name "backup-${CUR_YM}-*" | wc -l | tr -d ' ') == "2" ]] || \
    fail "--prune-only did not prune current month to 2"
[[ $(find "$PROJ5/backups" -maxdepth 1 -type d -name "backup-${PREV_YM}-*" | wc -l | tr -d ' ') == "3" ]] || \
    fail "--prune-only unexpectedly touched completed month backups"

# 5b: --dry-run on full run reports corrupt archive without deleting daily backups
PATH="$MOCK_FLOCK_BIN:$PATH" "$PROJ5/deploy/scripts/backup-maintenance.sh" --dry-run > "$LAST_RUN_LOG" 2>&1
grep -Fq 'Existing archive is corrupt' "$LAST_RUN_LOG" || fail "dry-run did not report corrupt archive"
[[ $(find "$PROJ5/backups" -maxdepth 1 -type d -name "backup-${PREV_YM}-*" | wc -l | tr -d ' ') == "3" ]] || \
    fail "dry-run removed daily backups"

# 5c: Full run rebuilds corrupt archive, verifies gzip -t, removes daily backups, no duplicate lines
PATH="$MOCK_FLOCK_BIN:$PATH" "$PROJ5/deploy/scripts/backup-maintenance.sh" > "$LAST_RUN_LOG" 2>&1
gzip -t "$PROJ5/backups/backup-${PREV_YM}.tar.gz" || fail "rebuilt archive failed gzip -t"
tar_content=$(tar -tzf "$PROJ5/backups/backup-${PREV_YM}.tar.gz")
grep -Fq "backup-${PREV_YM}-28_000100/data.json" <<< "$tar_content" || fail "archive did not contain last backup of month"
[[ $(find "$PROJ5/backups" -maxdepth 1 -type d -name "backup-${PREV_YM}-*" | wc -l | tr -d ' ') == "0" ]] || \
    fail "completed-month daily backups were not removed"
[[ $(find "$PROJ5/backups" -maxdepth 1 -name 'backup-*.tar.gz.tmp.*' | wc -l | tr -d ' ') == "0" ]] || \
    fail "temp archive remained after compression"
dup_count=$(awk '/Backup directory contents:/{flag=1} flag' "$LAST_RUN_LOG" | grep -c "backup-${PREV_YM}.tar.gz$" || true)
[[ "$dup_count" == "1" ]] || fail "expected 1 summary line for archive, got $dup_count"

# 5d: Failed tar leaves last daily backup intact
mkdir -p "$PROJ5/backups/backup-2025-11-30_000100"
printf 'keep me\n' > "$PROJ5/backups/backup-2025-11-30_000100/data.json"
FAIL_TAR_BIN="$TMP_DIR/fail-tar-bin"
mkdir -p "$FAIL_TAR_BIN"
printf '#!/usr/bin/env bash\necho "No space left" >&2\nexit 1\n' > "$FAIL_TAR_BIN/tar"
chmod +x "$FAIL_TAR_BIN/tar"
if PATH="$FAIL_TAR_BIN:$MOCK_FLOCK_BIN:$PATH" "$PROJ5/deploy/scripts/backup-maintenance.sh" 11/25 > "$LAST_RUN_LOG" 2>&1; then
    fail "backup-maintenance.sh returned 0 when tar failed"
fi
[[ -d "$PROJ5/backups/backup-2025-11-30_000100" ]] || fail "failed compression deleted source backup"

# 5e: Invalid KEEP_BACKUPS fails closed
for bad_keep in 0 -3 abc; do
    if KEEP_BACKUPS="$bad_keep" "$PROJ5/deploy/scripts/backup-maintenance.sh" > "$LAST_RUN_LOG" 2>&1; then
        fail "invalid KEEP_BACKUPS=$bad_keep did not fail"
    fi
done
[[ "$PREV_MM_YY" =~ ^[0-9]{2}/[0-9]{2}$ ]] || fail "unexpected PREV_MM_YY=$PREV_MM_YY"
pass "backup-maintenance.sh pruning, atomic compression, corrupt-archive recovery, and validation work"

# ---------------------------------------------------------------------------
# Test 6: update.sh 2-step cron-inode log rotation
# ---------------------------------------------------------------------------
PROJ6="$TMP_DIR/proj6"
setup_deploy_copy "$PROJ6"
CALLS6="$TMP_DIR/calls6.log"
LAST_RUN_LOG="$TMP_DIR/run6.log"
cat > "$PROJ6/deploy/config.env" <<EOF
R2_ENABLED=false
DO_ENABLED=false
OUTPUT_DIR=$PROJ6/public/data
BACKUP_DIR=$PROJ6/backups
RCLONE_PATH=$MOCK_BIN/rclone
UPDATE_LOG_MAX_BYTES=20
UPDATE_LOG_ARCHIVES=2
EOF

printf '1234567890123456789012345\n' > "$PROJ6/deploy/logs/update.log"
PATH="$MOCK_BIN:$MOCK_FLOCK_BIN:$PATH" MOCK_RCLONE_CALLS="$CALLS6" \
    "$PROJ6/deploy/scripts/update.sh" > "$LAST_RUN_LOG" 2>&1
[[ -f "$PROJ6/deploy/logs/update.log.1" && ! -e "$PROJ6/deploy/logs/update.log" ]] || \
    fail "step 1 rotation did not move update.log to update.log.1"

printf 'new cron run log\n' > "$PROJ6/deploy/logs/update.log"
PATH="$MOCK_BIN:$MOCK_FLOCK_BIN:$PATH" MOCK_RCLONE_CALLS="$CALLS6" \
    "$PROJ6/deploy/scripts/update.sh" >> "$PROJ6/deploy/logs/update.log" 2>&1
[[ -f "$PROJ6/deploy/logs/update.log.1.gz" && ! -e "$PROJ6/deploy/logs/update.log.1" ]] || \
    fail "step 2 rotation did not gzip update.log.1"
gzip -t "$PROJ6/deploy/logs/update.log.1.gz" || fail "rotated update.log.1.gz failed gzip -t"
pass "update.sh 2-step cron-safe log rotation works"
