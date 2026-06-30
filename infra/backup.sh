#!/usr/bin/env bash
# Kingdom 1516 — daily off-box backup (Story 3.1 / AC4, NFR-16).
#
# Runs ON the host (it needs the live SQLite file) and pushes artifacts OFF-box to
# Cloudflare R2 via rclone — that is the "off-box" in AC4: the destination, not the
# execution location. `sqlite3 .backup` is online-consistent, so Directus keeps
# running with no downtime.
#
# Schedule from host cron (see README -> Backups). The rclone remote and R2 creds
# live on the host (~/.config/rclone/rclone.conf) and are NEVER committed.
set -euo pipefail

# Config — override via the cron environment if names/retention differ.
DB_VOLUME="${DB_VOLUME:-directus_db}"
UPLOADS_VOLUME="${UPLOADS_VOLUME:-directus_uploads}"
RCLONE_REMOTE="${RCLONE_REMOTE:-r2:kingdom1516-backups}"
KEEP_DAILY_DAYS="${KEEP_DAILY_DAYS:-14}"
KEEP_WEEKLY_DAYS="${KEEP_WEEKLY_DAYS:-28}"  # ~4 weekly

stamp="$(date +%Y-%m-%d)"
weekday="$(date +%u)"  # 1=Mon .. 7=Sun
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

# Resolve the named-volume mountpoints on the host (needs docker access).
db_mount="$(docker volume inspect --format '{{ .Mountpoint }}' "$DB_VOLUME")"
uploads_mount="$(docker volume inspect --format '{{ .Mountpoint }}' "$UPLOADS_VOLUME")"

# 1) Online-consistent SQLite snapshot (no Directus downtime).
sqlite3 "$db_mount/data.db" ".backup '$workdir/data.db'"

# 2) Uploads tarball.
tar -czf "$workdir/uploads.tar.gz" -C "$uploads_mount" .

# 3) Push off-box to R2 under a dated daily prefix (and a weekly copy on Sundays).
rclone copy "$workdir" "$RCLONE_REMOTE/daily/$stamp/"
if [ "$weekday" = "7" ]; then
	rclone copy "$workdir" "$RCLONE_REMOTE/weekly/$stamp/"
fi

# 4) Retention prune: keep ~14 daily + ~4 weekly, drop the rest.
rclone delete --min-age "${KEEP_DAILY_DAYS}d"  --rmdirs "$RCLONE_REMOTE/daily"
rclone delete --min-age "${KEEP_WEEKLY_DAYS}d" --rmdirs "$RCLONE_REMOTE/weekly"

echo "backup ok: $stamp (daily; weekly=$([ "$weekday" = "7" ] && echo yes || echo no))"
