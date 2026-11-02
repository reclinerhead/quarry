#!/usr/bin/env bash
# backup.sh -- a consistent copy of the Quarry's database, the Aviary's recipe
# as the Conservatory uses it: the sqlite backup API reads THROUGH the WAL and
# writes one consolidated file. `cp quarry.db` on a live WAL database gives you
# a file with the new rows missing, silently.
#
#     bash ~/quarry/Servers/backup.sh            # -> ~/backups/quarry-<date>.db
#     bash ~/quarry/Servers/backup.sh /some/dir  # elsewhere
#
# The photos and their thumbnails are plain files under the data directory and
# need no ceremony: rsync or tar quarry-data/photos/ beside the .db. Copy them
# off the box; monthly is plenty while the collection is small, and before any
# migration step.

set -euo pipefail

ENVF=/etc/quarry/quarry.env
DB="${QUARRY_DB:-}"
if [ -z "$DB" ]; then
    # The env file is root-only; the default path is what it holds unless told otherwise.
    DB=$(sudo -n grep -m1 '^QUARRY_DB=' "$ENVF" 2>/dev/null | cut -d= -f2- || true)
    DB="${DB:-$HOME/quarry-data/quarry.db}"
fi
OUT_DIR="${1:-$HOME/backups}"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/quarry-$(date +%F).db"

python3 - "$DB" "$OUT" <<'PY'
import sqlite3, sys
src = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True)
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
dst.close()
c = sqlite3.connect(sys.argv[2])
print("quick_check:", c.execute("pragma quick_check").fetchone()[0])
for t in ("photos", "jobs", "candidates", "minerals", "specimens", "confirmations"):
    print(f"{t}: {c.execute(f'select count(*) from {t}').fetchone()[0]}")
c.close()
src.close()
PY
echo "wrote $OUT"
