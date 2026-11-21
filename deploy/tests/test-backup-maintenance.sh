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
        if [[ -n "${MOCK_BACKUP_READY_FILE:-}" && "$dst" == */.tmp-backup-* ]]; then
            : > "$MOCK_BACKUP_READY_FILE"
        fi
        if [[ -n "${MOCK_BACKUP_RELEASE_FILE:-}" && "$dst" == */.tmp-backup-* ]]; then
            _w=0
            while [[ ! -e "$MOCK_BACKUP_RELEASE_FILE" ]] && (( _w < 100 )); do
                sleep 0.1
                _w=$((_w + 1))
            done
        fi
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

# Always provide deterministic flock stub (contends when MOCK_FLOCK_CONTEND=1;
# otherwise delegates to real flock when available so real locking works cleanly)
MOCK_FLOCK_BIN="$TMP_DIR/mock-flock-bin"
mkdir -p "$MOCK_FLOCK_BIN"
REAL_FLOCK="$(command -v flock 2>/dev/null || true)"
cat > "$MOCK_FLOCK_BIN/flock" <<EOF
#!/usr/bin/env bash
if [[ "\${MOCK_FLOCK_CONTEND:-0}" == "1" ]]; then
    exit 1
fi
if [[ -n "\${MOCK_FLOCK_CONTEND_FD:-}" && "\${2:-}" == "\$MOCK_FLOCK_CONTEND_FD" ]]; then
    exit 1
fi
if [[ -n "$REAL_FLOCK" ]]; then
    exec "$REAL_FLOCK" "\$@"
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
if ! PATH="$MOCK_BIN:$MOCK_FLOCK_BIN:$PATH" NODE_CMD="$MOCK_BIN/node" NPX_CMD="$MOCK_BIN/npx" MOCK_RCLONE_CALLS="$CALLS1" \
    "$PROJ1/deploy/scripts/update.sh" > "$LAST_RUN_LOG" 2>&1; then
    fail "Test 1 update.sh failed"
fi

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
if ! PATH="$MOCK_BIN:$MOCK_FLOCK_BIN:$PATH" NODE_CMD="$MOCK_BIN/node" NPX_CMD="$MOCK_BIN/npx" MOCK_RCLONE_CALLS="$CALLS2" \
    "$PROJ2/deploy/scripts/update.sh" > "$LAST_RUN_LOG" 2>&1; then
    fail "Test 2 update.sh failed"
fi

do_local_calls=$(grep -c 'sync spaces-rfm:test-do-bucket .*/.tmp-backup-' "$CALLS2" || true)
[[ "$do_local_calls" == "1" ]] || fail "expected DO-only run to create 1 local backup, got $do_local_calls"
pass "update.sh with R2 disabled lets DO take local backup"

# ---------------------------------------------------------------------------
# Test 2b: update.sh falls back to DO local backup when R2 fails pre-checks
# ---------------------------------------------------------------------------
PROJ2B="$TMP_DIR/proj2b"
setup_deploy_copy "$PROJ2B"
CALLS2B="$TMP_DIR/calls2b.log"
LAST_RUN_LOG="$TMP_DIR/run2b.log"
cat > "$PROJ2B/deploy/config.env" <<EOF
R2_ENABLED=true
DO_ENABLED=true
DO_SPACES_BUCKET=test-do-bucket
DO_SPACES_KEY=dk
DO_SPACES_SECRET=ds
DO_SPACES_REGION=nyc3
OUTPUT_DIR=$PROJ2B/public/data
BACKUP_DIR=$PROJ2B/backups
RCLONE_PATH=$MOCK_BIN/rclone
EOF

: > "$CALLS2B"
if ! PATH="$MOCK_BIN:$MOCK_FLOCK_BIN:$PATH" NODE_CMD="$MOCK_BIN/node" NPX_CMD="$MOCK_BIN/npx" MOCK_RCLONE_CALLS="$CALLS2B" \
    "$PROJ2B/deploy/scripts/update.sh" > "$LAST_RUN_LOG" 2>&1; then
    fail "Test 2b update.sh failed"
fi

do_local_line=$(grep -nE 'sync spaces-rfm:test-do-bucket .*/\.tmp-backup-' "$CALLS2B" | head -n 1 | cut -d: -f1)
do_live_line=$(grep -nE "sync $PROJ2B/public/data spaces-rfm:test-do-bucket " "$CALLS2B" | head -n 1 | cut -d: -f1)
do_local_calls=$(grep -c 'sync spaces-rfm:test-do-bucket .*/.tmp-backup-' "$CALLS2B" || true)
[[ "$do_local_calls" == "1" ]] || fail "expected DO fallback local backup when R2 failed pre-checks, got $do_local_calls"
[[ -n "$do_local_line" && -n "$do_live_line" && "$do_local_line" -lt "$do_live_line" ]] || \
    fail "DO fallback backup ($do_local_line) did not run BEFORE DO live upload ($do_live_line)"
[[ -f "$PROJ2B/deploy/logs/last-local-backup-date" ]] || fail "DO fallback did not write shared local backup marker"
pass "update.sh falls back to DO local backup before live sync when R2 fails"

# ---------------------------------------------------------------------------
# Test 3: Shared marker, flock contention, and post-lock stderr preservation
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
if ! PATH="$MOCK_BIN:$MOCK_FLOCK_BIN:$PATH" MOCK_RCLONE_CALLS="$CALLS3" \
    "$PROJ3/deploy/scripts/upload-r2.sh" "$PROJ3/public/data" > "$LAST_RUN_LOG" 2>&1; then
    fail "Test 3 upload-r2.sh failed"
fi
if ! PATH="$MOCK_BIN:$MOCK_FLOCK_BIN:$PATH" MOCK_RCLONE_CALLS="$CALLS3" \
    "$PROJ3/deploy/scripts/upload-do.sh" "$PROJ3/public/data" >> "$LAST_RUN_LOG" 2>&1; then
    fail "Test 3 upload-do.sh failed"
fi
local_calls=$(grep -c '/.tmp-backup-' "$CALLS3" || true)
[[ "$local_calls" == "1" ]] || fail "sequential R2 then DO created $local_calls local backups instead of 1"

rm -f "$PROJ3/deploy/logs/last-local-backup-date"
: > "$CALLS3"
if PATH="$MOCK_FLOCK_BIN:$MOCK_BIN:$PATH" MOCK_FLOCK_CONTEND=1 MOCK_FAIL_UPLOAD=1 MOCK_RCLONE_CALLS="$CALLS3" \
    "$PROJ3/deploy/scripts/upload-do.sh" "$PROJ3/public/data" > "$LAST_RUN_LOG" 2>&1; then
    fail "Test 3 upload failure did not exit non-zero"
fi
grep -Fq 'another local backup is already in progress' "$LAST_RUN_LOG" || \
    fail "flock contention was not logged"
grep -Fq 'mock upload failure' "$LAST_RUN_LOG" || \
    fail "stderr was lost after flock release"
[[ "$(grep -c '/.tmp-backup-' "$CALLS3" || true)" == "0" ]] || \
    fail "flock contention still ran local backup"
pass "shared marker, flock contention, and post-lock stderr preservation work"

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
if ! PATH="$MOCK_BIN:$MOCK_FLOCK_BIN:$PATH" MOCK_RCLONE_CALLS="$CALLS4" MOCK_FAIL_LOCAL_BACKUP=1 \
    "$PROJ4/deploy/scripts/upload-r2.sh" "$PROJ4/public/data" > "$LAST_RUN_LOG" 2>&1; then
    fail "Test 4 upload-r2.sh with failing local backup exited non-zero"
fi
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

# 5a: Contend ONLY local backup lock (FD 7); maintenance runs (takes FD 8) and skips stale .tmp-backup-* cleanup
touch "$PROJ5/deploy/logs/.local-backup.lock"
if ! PATH="$MOCK_FLOCK_BIN:$PATH" MOCK_FLOCK_CONTEND_FD=7 "$PROJ5/deploy/scripts/backup-maintenance.sh" --prune-only > "$LAST_RUN_LOG" 2>&1; then
    fail "backup-maintenance.sh --prune-only failed under lock contention"
fi
grep -Fq 'Skipping stale temp backup cleanup (local backup lock is held)' "$LAST_RUN_LOG" || \
    fail "lock-held skip message missing"
[[ -d "$PROJ5/backups/.tmp-backup-stale" ]] || fail "stale .tmp-backup was removed while lock held"

# 5a-2: --prune-only leaves completed-month daily backups and corrupt archive untouched
if ! PATH="$MOCK_FLOCK_BIN:$PATH" "$PROJ5/deploy/scripts/backup-maintenance.sh" --prune-only > "$LAST_RUN_LOG" 2>&1; then
    fail "backup-maintenance.sh --prune-only failed"
fi
[[ ! -e "$PROJ5/backups/.tmp-backup-stale" ]] || fail "stale .tmp-backup was not removed"
[[ -d "$PROJ5/backups/.tmp-backup-fresh" ]] || fail "fresh .tmp-backup was removed prematurely"
[[ ! -e "$PROJ5/backups/backup-2025-12.tar.gz.tmp.999" ]] || fail "stale .tar.gz.tmp was not removed"
[[ $(find "$PROJ5/backups" -maxdepth 1 -type d -name "backup-${CUR_YM}-*" | wc -l | tr -d ' ') == "2" ]] || \
    fail "--prune-only did not prune current month to 2"
[[ $(find "$PROJ5/backups" -maxdepth 1 -type d -name "backup-${PREV_YM}-*" | wc -l | tr -d ' ') == "3" ]] || \
    fail "--prune-only unexpectedly touched completed month backups"

# 5b: --dry-run on full run reports corrupt archive without deleting daily backups
if ! PATH="$MOCK_FLOCK_BIN:$PATH" "$PROJ5/deploy/scripts/backup-maintenance.sh" --dry-run > "$LAST_RUN_LOG" 2>&1; then
    fail "backup-maintenance.sh --dry-run failed"
fi
grep -Fq 'Existing archive is corrupt' "$LAST_RUN_LOG" || fail "dry-run did not report corrupt archive"
[[ $(find "$PROJ5/backups" -maxdepth 1 -type d -name "backup-${PREV_YM}-*" | wc -l | tr -d ' ') == "3" ]] || \
    fail "dry-run removed daily backups"

# 5c: Full run rebuilds corrupt archive, verifies gzip -t, removes daily backups, no duplicate lines
if ! PATH="$MOCK_FLOCK_BIN:$PATH" "$PROJ5/deploy/scripts/backup-maintenance.sh" > "$LAST_RUN_LOG" 2>&1; then
    fail "backup-maintenance.sh full run failed"
fi
gzip -t "$PROJ5/backups/backup-${PREV_YM}.tar.gz" || fail "rebuilt archive failed gzip -t"
tar_content=$(tar -tzf "$PROJ5/backups/backup-${PREV_YM}.tar.gz")
grep -Fq "backup-${PREV_YM}-28_000100/data.json" <<< "$tar_content" || fail "archive did not contain last backup of month"
[[ $(find "$PROJ5/backups" -maxdepth 1 -type d -name "backup-${PREV_YM}-*" | wc -l | tr -d ' ') == "0" ]] || \
    fail "completed-month daily backups were not removed"
[[ $(find "$PROJ5/backups" -maxdepth 1 -name 'backup-*.tar.gz.tmp.*' | wc -l | tr -d ' ') == "0" ]] || \
    fail "temp archive remained after compression"
dup_count=$(awk '/Backup directory contents:/{flag=1} flag' "$LAST_RUN_LOG" | grep -c "backup-${PREV_YM}.tar.gz$" || true)
[[ "$dup_count" == "1" ]] || fail "expected 1 summary line for archive, got $dup_count"

# 5c-2: Re-running full backup-maintenance.sh with zero completed months succeeds under nounset
if ! PATH="$MOCK_FLOCK_BIN:$PATH" "$PROJ5/deploy/scripts/backup-maintenance.sh" > "$LAST_RUN_LOG" 2>&1; then
    fail "backup-maintenance.sh failed when zero completed months remained (MONTHS_FOUND under set -u)"
fi
grep -Fq 'No completed months with daily backups found' "$LAST_RUN_LOG" || \
    fail "expected empty completed-months message"

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

# 5d-2: Fallback --local-backup-only returns non-zero when rclone fails, and Test 3 lock file is mode 600
if PATH="$MOCK_BIN:$MOCK_FLOCK_BIN:$PATH" MOCK_RCLONE_CALLS="$CALLS4" MOCK_FAIL_LOCAL_BACKUP=1 \
    "$PROJ3/deploy/scripts/upload-do.sh" --local-backup-only "$PROJ3/public/data" > "$LAST_RUN_LOG" 2>&1; then
    fail "upload-do.sh --local-backup-only returned 0 despite local backup failure"
fi
lock_mode=$(stat -c '%a' "$PROJ3/deploy/logs/.local-backup.lock" 2>/dev/null || stat -f '%Lp' "$PROJ3/deploy/logs/.local-backup.lock")
[[ "$lock_mode" == "600" ]] || fail "expected .local-backup.lock mode 600, got $lock_mode"
if grep -qE '/tmp/.*routefluxmap.*lock' "$PROJ1/deploy/configs/routefluxmap.cron.d" "$PROJ1/deploy/scripts/cron-manage.sh"; then
    fail "predictable /tmp lock reference still present in cron config or cron-manage.sh"
fi

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
if ! (
    exec 6>>"$PROJ6/deploy/logs/update.log"
    PATH="$MOCK_BIN:$MOCK_FLOCK_BIN:$PATH" NODE_CMD="$MOCK_BIN/node" NPX_CMD="$MOCK_BIN/npx" MOCK_RCLONE_CALLS="$CALLS6" \
        "$PROJ6/deploy/scripts/update.sh" >&6 2>&1 || exit $?
    printf 'post-rotation-append-fd\n' >&6
    exec 6>&-
); then
    fail "Test 6 step 1 update.sh failed"
fi
[[ -f "$PROJ6/deploy/logs/update.log.1.gz" && -f "$PROJ6/deploy/logs/update.log" ]] || \
    fail "copy-truncate rotation did not produce update.log.1.gz while preserving update.log"
gzip -t "$PROJ6/deploy/logs/update.log.1.gz" || fail "rotated update.log.1.gz failed gzip -t"
gzip -dc "$PROJ6/deploy/logs/update.log.1.gz" | grep -qxF '1234567890123456789012345' || \
    fail "rotated update.log.1.gz does not contain pre-rotation log contents"
grep -qxF 'post-rotation-append-fd' "$PROJ6/deploy/logs/update.log" || \
    fail "pre-opened append descriptor output did not reach active update.log after rotation"

printf 'second rotation log payload 1234567890\n' >> "$PROJ6/deploy/logs/update.log"
if ! PATH="$MOCK_BIN:$MOCK_FLOCK_BIN:$PATH" NODE_CMD="$MOCK_BIN/node" NPX_CMD="$MOCK_BIN/npx" MOCK_RCLONE_CALLS="$CALLS6" \
    "$PROJ6/deploy/scripts/update.sh" >> "$PROJ6/deploy/logs/update.log" 2>&1; then
    fail "Test 6 step 2 update.sh failed"
fi
[[ -f "$PROJ6/deploy/logs/update.log.2.gz" && -f "$PROJ6/deploy/logs/update.log.1.gz" ]] || \
    fail "step 2 rotation did not shift update.log.1.gz to update.log.2.gz"
gzip -t "$PROJ6/deploy/logs/update.log.2.gz" || fail "rotated update.log.2.gz failed gzip -t"

if PATH="$MOCK_BIN:$MOCK_FLOCK_BIN:$PATH" NODE_CMD="$MOCK_BIN/node" NPX_CMD="$MOCK_BIN/npx" MOCK_RCLONE_CALLS="$CALLS6" \
    UPDATE_LOG_FILE="$PROJ6/deploy/logs/../../escaped.log" \
    "$PROJ6/deploy/scripts/update.sh" > "$LAST_RUN_LOG" 2>&1; then
    fail "update.sh accepted path-traversal UPDATE_LOG_FILE"
fi
grep -Fq 'Refusing unsafe UPDATE_LOG_FILE=' "$LAST_RUN_LOG" || \
    fail "path-traversal UPDATE_LOG_FILE rejection message missing"
pass "update.sh copy-truncate cron-safe log rotation and canonical path check work"

# ---------------------------------------------------------------------------
# Test 7: cron-manage.sh verification predicates ignore comments & non-exec text
# ---------------------------------------------------------------------------
PROJ7="$TMP_DIR/proj7"
setup_deploy_copy "$PROJ7"
CRON_D_MOCK="$TMP_DIR/mock-cron.d-routefluxmap"

cat > "$CRON_D_MOCK" <<'EOF'
0 */4 * * * tor /opt/update.sh
# 30 6 * * * tor /opt/backup-maintenance.sh
EOF
bash -c '
    set -euo pipefail
    source "$1"
    if cron_d_has_daily_maintenance_job "$2"; then exit 1; fi
    cron_d_has_update_job "$2"
' _ "$PROJ7/deploy/scripts/cron-manage.sh" "$CRON_D_MOCK" || \
    fail "commented backup-maintenance line matched daily check or active update.sh missed"

sed 's/^# //' "$CRON_D_MOCK" > "${CRON_D_MOCK}.active"
bash -c '
    set -euo pipefail
    source "$1"
    cron_d_has_daily_maintenance_job "$2"
' _ "$PROJ7/deploy/scripts/cron-manage.sh" "${CRON_D_MOCK}.active" || \
    fail "active 30 6 * * * line did not match daily check"

cat > "${CRON_D_MOCK}.indented" <<'EOF'
  # 0 */4 * * * tor /opt/update.sh
30 6 * * * tor /usr/bin/echo backup-maintenance.sh >> /var/log/update.sh.log 2>&1
EOF
bash -c '
    set -euo pipefail
    source "$1"
    if cron_d_has_update_job "$2"; then exit 1; fi
    if cron_d_has_daily_maintenance_job "$2"; then exit 1; fi
' _ "$PROJ7/deploy/scripts/cron-manage.sh" "${CRON_D_MOCK}.indented" || \
    fail "indented comment, echo arg, or redirect target matched command check"

cat > "${CRON_D_MOCK}.monthly" <<'EOF'
0 */4 * * * tor /opt/update.sh
0 3 1 * * tor /opt/backup-maintenance.sh
EOF
bash -c '
    set -euo pipefail
    source "$1"
    cron_d_has_monthly_maintenance_job "$2"
    if cron_d_has_daily_maintenance_job "$2"; then exit 1; fi
' _ "$PROJ7/deploy/scripts/cron-manage.sh" "${CRON_D_MOCK}.monthly" || \
    fail "monthly backup-maintenance entry check failed"
pass "cron-manage verification predicates check scheduled command and ignore comments"

# ---------------------------------------------------------------------------
# Test 9: Wait timeout and locked coordinated fallback abort DO before live sync
# ---------------------------------------------------------------------------
PROJ9="$TMP_DIR/proj9"
setup_deploy_copy "$PROJ9"
CALLS9="$TMP_DIR/calls9.log"
RESULT9="$TMP_DIR/r2-timeout.result"
TIMEOUT9_READY="$TMP_DIR/r9-timeout.ready"
TIMEOUT9_RELEASE="$TMP_DIR/r9-timeout.release"
cat > "$PROJ9/deploy/config.env" <<EOF
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
OUTPUT_DIR=$PROJ9/public/data
BACKUP_DIR=$PROJ9/backups
RCLONE_PATH=$MOCK_BIN/rclone
EOF

: > "$CALLS9"
rm -f "$RESULT9" "$TIMEOUT9_READY" "$TIMEOUT9_RELEASE"
r9_r2_pid="" r9_do_pid=""
stop_test9_procs() {
    : > "$TIMEOUT9_RELEASE" 2>/dev/null || true
    if [[ -n "$r9_r2_pid" ]]; then
        kill "$r9_r2_pid" 2>/dev/null || true
        wait "$r9_r2_pid" 2>/dev/null || true
        r9_r2_pid=""
    fi
    if [[ -n "$r9_do_pid" ]]; then
        kill "$r9_do_pid" 2>/dev/null || true
        wait "$r9_do_pid" 2>/dev/null || true
        r9_do_pid=""
    fi
}
trap 'stop_test9_procs; rm -rf "$TMP_DIR"' EXIT
PATH="$MOCK_BIN:$MOCK_FLOCK_BIN:$PATH" MOCK_BACKUP_READY_FILE="$TIMEOUT9_READY" MOCK_BACKUP_RELEASE_FILE="$TIMEOUT9_RELEASE" \
    MOCK_FAIL_LOCAL_BACKUP=1 MOCK_RCLONE_CALLS="$CALLS9" ROUTEFLUXMAP_LOCAL_BACKUP_RESULT_FILE="$RESULT9" \
    "$PROJ9/deploy/scripts/upload-r2.sh" "$PROJ9/public/data" > "$TMP_DIR/r9-r2.log" 2>&1 &
r9_r2_pid=$!
r9_waited=0
while [[ ! -e "$TIMEOUT9_READY" ]] && (( r9_waited < 50 )); do
    sleep 0.1
    r9_waited=$((r9_waited + 1))
done
[[ -e "$TIMEOUT9_READY" ]] || {
    stop_test9_procs
    fail "Test 9 R2 mock backup did not reach readiness barrier in time"
}
PATH="$MOCK_BIN:$MOCK_FLOCK_BIN:$PATH" MOCK_RCLONE_CALLS="$CALLS9" \
    ROUTEFLUXMAP_PRIMARY_LOCAL_BACKUP_RESULT_FILE="$RESULT9" ROUTEFLUXMAP_LOCAL_BACKUP_WAIT_TIMEOUT=1 \
    "$PROJ9/deploy/scripts/upload-do.sh" "$PROJ9/public/data" > "$TMP_DIR/r9-do.log" 2>&1 &
r9_do_pid=$!
r9_r2_rc=0 r9_do_rc=0
wait "$r9_do_pid" || r9_do_rc=$?
r9_do_pid=""
: > "$TIMEOUT9_RELEASE"
wait "$r9_r2_pid" || r9_r2_rc=$?
r9_r2_pid=""
trap 'rm -rf "$TMP_DIR"' EXIT
[[ "$r9_r2_rc" == "0" ]] || fail "Test 9 R2 exited non-zero ($r9_r2_rc) despite continuing after local backup failure"
[[ "$r9_do_rc" != "0" ]] || fail "DO did not abort after wait timeout"
[[ "$(grep -c 'spaces-rfm:test-do-bucket' "$CALLS9" || true)" == "0" ]] || \
    fail "DO touched live bucket despite primary wait timeout"
grep -Fq 'aborting DO upload to preserve pre-upload snapshot' "$TMP_DIR/r9-do.log" || \
    fail "DO timeout abort message missing"

printf 'failed\n' > "$RESULT9"
: > "$CALLS9"
rm -f "$PROJ9/deploy/logs/last-local-backup-date"
if PATH="$MOCK_BIN:$MOCK_FLOCK_BIN:$PATH" MOCK_FLOCK_CONTEND=1 MOCK_RCLONE_CALLS="$CALLS9" \
    ROUTEFLUXMAP_PRIMARY_LOCAL_BACKUP_RESULT_FILE="$RESULT9" \
    "$PROJ9/deploy/scripts/upload-do.sh" "$PROJ9/public/data" > "$TMP_DIR/r9-locked.log" 2>&1; then
    fail "coordinated DO fallback exited 0 despite lock contention"
fi
[[ "$(grep -c 'spaces-rfm:test-do-bucket' "$CALLS9" || true)" == "0" ]] || \
    fail "coordinated locked fallback touched DO live bucket"
pass "coordinated DO upload aborts safely without overwriting bucket on timeout or lock contention"
