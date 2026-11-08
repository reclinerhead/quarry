#!/usr/bin/env bash
# install-station.sh -- bring the Quarry up on a field station (birdhouse,
# kestrel; issue #101), or bring it current after a change to a unit. Run
# WITH sudo, from anywhere:
#
#     sudo bash ~/quarry/Servers/install-station.sh
#
# The first time, clone the repo first (as todd, not root):
#
#     git clone https://github.com/reclinerhead/quarry.git ~/quarry && sudo bash ~/quarry/Servers/install-station.sh
#
# A sibling of install-orchid.sh, not a flag on it: the two boxes share the
# middle (venv, database, build, units) and differ at both ends (keys and
# door), and this script must be unable to touch Caddy by construction. A
# station is a guest in a house two hours from a keyboard: it rides the
# release channel (quarry-station-stable, main with a delay), its door is the
# Aviary's Caddyfile (synced by hand, never by this script), and its gateway
# key is its own, with its own spend limit.
#
# Idempotent: every step checks what is there and changes only what differs.
# It never touches the Aviary's units, env file, watcher or checkout, never
# /etc/caddy, and never the data directory's contents. In order:
#
#   1. preflight: the checkout, node 24+ through todd's login shell (/usr/bin
#      on a station; nvm is fine too, and no nvm is not an error), pnpm, uv,
#      port 3020, the Aviary still running
#   2. the channel: the checkout moves from main to quarry-station-stable
#   3. the data directory outside the checkout, owned by todd
#   4. the environment file at /etc/quarry/quarry.env (copied from the example
#      when missing, left alone when you wrote it yourself) with
#      QUARRY_DEPLOY_BRANCH=quarry-station-stable in it
#   5. the keys: the gateway key by paste (one key per station, with its own
#      spend limit in the gateway's dashboard), the Mindat key by paste or
#      Enter to skip. Written without being echoed or put on a command line
#   6. web/.env.local with NEXT_PUBLIC_BASE_PATH=/quarry (#100), only if absent
#   7. Jasper's venv and its packages
#   8. the database: created and migrated, so the web app has one before
#      Jasper's first job
#   9. the web app's install + build
#  10. the three units, enabled and started; the node-path drop-in only when
#      node lives under nvm
#  11. the door, checked only: http://127.0.0.1/quarry through the station's
#      Caddy. Anything but 200 means the Aviary's Caddyfile.station needs its
#      /quarry route (reclinerhead/aviary#684) and a sync on this box
#  12. what is left for you
#
# Nothing here is a paste block: run it, read it, re-run it.

set -uo pipefail

OWNER=todd
REPO=/home/todd/quarry
DATA=/home/todd/quarry-data
ENVDIR=/etc/quarry
ENVF=$ENVDIR/quarry.env
WEB_ENV=$REPO/web/.env.local
SD=/etc/systemd/system
PORT=3020
CHANNEL=quarry-station-stable
BASE_PATH=/quarry
CADDY_LIVE=/etc/caddy/Caddyfile
CADDY_AVIARY=/home/$OWNER/aviary/Servers/Caddyfile.station

say()  { printf '\n==> %s\n' "$*"; }
ok()   { printf '    ok   %s\n' "$*"; }
warn() { printf '    WARN %s\n' "$*"; }
die()  { printf '\n!! STOP: %s\n' "$*" >&2; exit 1; }
as_owner() { setpriv --reuid="$OWNER" --regid="$OWNER" --init-groups --reset-env "$@"; }

# The value of NAME in an env file, or nothing. Builtins only.
env_value() {
    local name="$1" file="$2" line
    [ -r "$file" ] || return 1
    while IFS= read -r line || [ -n "$line" ]; do
        if [[ "$line" == "$name="* ]]; then
            printf '%s' "${line#"$name="}"
            return 0
        fi
    done < "$file"
    return 1
}

# Rewrite the NAME= line of $ENVF, or add it when the file has none. Builtins
# only (printf and read are not processes), so a key never appears in any
# command's argv.
write_var() {
    local name="$1" value="$2" tmp line found=0
    tmp=$(mktemp "$ENVDIR/.quarry.env.XXXXXX") || die "mktemp in $ENVDIR"
    while IFS= read -r line || [ -n "$line" ]; do
        if [[ "$line" == "$name="* ]]; then
            printf '%s=%s\n' "$name" "$value"
            found=1
        else
            printf '%s\n' "$line"
        fi
    done < "$ENVF" > "$tmp"
    [ "$found" -eq 1 ] || printf '%s=%s\n' "$name" "$value" >> "$tmp"
    chmod 0600 "$tmp" && mv "$tmp" "$ENVF" || die "could not write $ENVF"
}

has_key() { [ -n "$(env_value AI_GATEWAY_API_KEY "$ENVF")" ]; }
has_mindat_key() { [ -n "$(env_value MINDAT_API_KEY "$ENVF")" ]; }
door_code() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1$BASE_PATH" 2>/dev/null; }

[ "$(id -u)" -eq 0 ] || die "run with sudo: sudo bash $REPO/Servers/install-station.sh"

say "1/12 Preflight"
[ -d "$REPO/.git" ] || die "no checkout at $REPO (as $OWNER: git clone https://github.com/reclinerhead/quarry.git $REPO)"
[ "$(stat -c %U "$REPO")" = "$OWNER" ] || die "$REPO is not owned by $OWNER"
ok "checkout at $(as_owner git -C "$REPO" rev-parse --short HEAD) on $(as_owner git -C "$REPO" rev-parse --abbrev-ref HEAD)"
# Node is wherever todd's login shell finds it: /usr/bin/node from NodeSource
# on a station, nvm's versioned bin on a box that has nvm. The unit needs the
# directory only in the nvm case (step 10).
NODE=$(as_owner bash -lc "command -v node" 2>/dev/null | tail -n 1)
[ -n "$NODE" ] && [ -x "$NODE" ] || die "no node on $OWNER's login PATH (a station has NodeSource's /usr/bin/node)"
NODE_MAJOR=$("$NODE" --version | sed 's/^v//' | cut -d. -f1)
[ "$NODE_MAJOR" -ge 24 ] 2>/dev/null || die "node $("$NODE" --version) at $NODE; node:sqlite needs 24+"
NODE_BIN=$(dirname "$NODE")
case "$NODE_BIN" in
    /home/$OWNER/.nvm/*) NODE_UNDER_NVM=1 ;;
    *) NODE_UNDER_NVM=0 ;;
esac
as_owner bash -lc "command -v pnpm >/dev/null" || die "pnpm is not on $OWNER's login PATH (the Aviary's build needs it too)"
ok "node $("$NODE" --version) at $NODE; pnpm on the login PATH"
UV=/home/$OWNER/.local/bin/uv
if [ -x "$UV" ]; then
    ok "uv at $UV (Jasper gets Python 3.13)"
else
    warn "no uv; Jasper will use the system python3 ($(python3 --version 2>&1))"
fi
if ! systemctl is-active --quiet quarry-web && [ -n "$(ss -ltnH "sport = :$PORT" 2>/dev/null)" ]; then
    die "something else is listening on :$PORT ($(ss -ltnpH "sport = :$PORT" | head -n 1)); the Quarry's port must be free"
fi
ok "port $PORT is the Quarry's"
if systemctl is-active --quiet aviary-web; then
    ok "aviary-web is running and stays untouched"
else
    warn "aviary-web is not running; nothing here touches it, but the station's door is its Caddy"
fi
for u in station-autodeploy station-checkin; do
    systemctl is-active --quiet "$u" && ok "$u is running and stays untouched"
done

say "2/12 The channel ($CHANNEL)"
branch=$(as_owner git -C "$REPO" rev-parse --abbrev-ref HEAD)
if [ "$branch" = "$CHANNEL" ]; then
    ok "the checkout is on $CHANNEL"
elif [ "$branch" = main ]; then
    as_owner git -C "$REPO" fetch --quiet origin "$CHANNEL" \
        || die "origin has no $CHANNEL yet; create it once from main's tip: git push origin origin/main:refs/heads/$CHANNEL"
    [ -z "$(as_owner git -C "$REPO" status --porcelain --untracked-files=no)" ] || die "the checkout has tracked changes; clean it before switching channels"
    as_owner git -C "$REPO" checkout --quiet -B "$CHANNEL" "origin/$CHANNEL" || die "could not check out $CHANNEL"
    ok "moved from main to $CHANNEL ($(as_owner git -C "$REPO" rev-parse --short HEAD))"
else
    warn "the checkout is on '$branch': the watcher reads that as pinned and deploys nothing until it is back on $CHANNEL"
fi

say "3/12 Data directory ($DATA, outside the checkout)"
if [ ! -d "$DATA" ]; then
    install -d -o "$OWNER" -g "$OWNER" -m 0755 "$DATA" || die "mkdir $DATA"
    ok "created"
else
    ok "exists"
fi
[ "$(stat -c %U "$DATA")" = "$OWNER" ] || die "$DATA is not owned by $OWNER"
as_owner mkdir -p "$DATA/photos"

say "4/12 Environment file ($ENVF)"
install -d -m 0755 "$ENVDIR"
if [ ! -f "$ENVF" ]; then
    install -m 0600 -o root -g root "$REPO/Servers/quarry.env.example" "$ENVF" || die "copy the example"
    ok "created from the example"
else
    ok "exists (left as is, but for the channel line below)"
fi
chmod 0600 "$ENVF"
for v in QUARRY_DB QUARRY_DATA AI_GATEWAY_API_KEY; do
    grep -q "^$v=" "$ENVF" || die "$ENVF lacks a $v= line (compare it with Servers/quarry.env.example)"
done
if ! grep -q "^MINDAT_API_KEY=" "$ENVF"; then
    printf '\n# OpenMindat API key (mindat.org). Jasper only, and optional.\nMINDAT_API_KEY=\n' >> "$ENVF" || die "could not add MINDAT_API_KEY= to $ENVF"
    ok "added an empty MINDAT_API_KEY= line (step 5 asks for it)"
fi
if [ "$(env_value QUARRY_DEPLOY_BRANCH "$ENVF")" = "$CHANNEL" ]; then
    ok "QUARRY_DEPLOY_BRANCH=$CHANNEL"
else
    write_var QUARRY_DEPLOY_BRANCH "$CHANNEL"
    ok "QUARRY_DEPLOY_BRANCH=$CHANNEL written (the watcher follows the channel, not main)"
fi
DB=$(env_value QUARRY_DB "$ENVF")
[ -n "$DB" ] || die "QUARRY_DB is empty in $ENVF"

say "5/12 The keys"
if has_key; then
    ok "AI_GATEWAY_API_KEY is set (left as is; to change it: sudoedit $ENVF, then sudo systemctl restart jasper)"
elif [ ! -t 0 ]; then
    warn "AI_GATEWAY_API_KEY is empty and nobody is at the keyboard to ask; Jasper waits for it"
else
    echo "    Jasper needs a Vercel AI Gateway key. One key per station, with its own spend"
    echo "    limit in the gateway's dashboard, so a runaway here can never spend another box's budget."
    read -r -s -p "    Paste this station's key (it will not show), or just Enter for not now: " new_key
    echo
    if [ -z "$new_key" ]; then
        warn "no key yet; re-run this script when you have it (everything else comes up; Jasper waits)"
    elif [[ "$new_key" =~ [[:space:]] ]]; then
        die "that key has a space in it; re-run and paste it again"
    else
        write_var AI_GATEWAY_API_KEY "$new_key"
        ok "the key is in $ENVF"
    fi
    unset new_key
fi
if has_mindat_key; then
    ok "MINDAT_API_KEY is set (left as is; to change it: sudoedit $ENVF, then sudo systemctl restart jasper)"
elif [ ! -t 0 ]; then
    warn "MINDAT_API_KEY is empty and nobody is at the keyboard to ask; Jasper matches candidates by name only"
else
    echo "    With a Mindat key, Jasper looks each suggestion up in Mindat, so two names for"
    echo "    one stone (Quartz and Chalcedony, both saying agate) count as agreeing. Optional;"
    echo "    one Mindat key shared between the boxes is fine."
    read -r -s -p "    Paste the Mindat API key (it will not show), or just Enter to skip: " mindat_key
    echo
    if [ -z "$mindat_key" ]; then
        warn "no Mindat key; candidates are matched by name only (re-run this script to add one)"
    elif [[ "$mindat_key" =~ [[:space:]] ]]; then
        die "that key has a space in it; re-run and paste it again"
    else
        write_var MINDAT_API_KEY "$mindat_key"
        ok "the Mindat key is in $ENVF"
    fi
    unset mindat_key
fi

say "6/12 The base path ($WEB_ENV)"
# Build-time, so it lives beside the build, owned by todd, not in the
# root-only env file the build cannot read (#100). Written only if absent, so
# a hand edit survives.
if [ -f "$WEB_ENV" ]; then
    if grep -q "^NEXT_PUBLIC_BASE_PATH=$BASE_PATH$" "$WEB_ENV"; then
        ok "NEXT_PUBLIC_BASE_PATH=$BASE_PATH (left as is)"
    else
        warn "$WEB_ENV exists without NEXT_PUBLIC_BASE_PATH=$BASE_PATH; left as is, but the app will not sit under $BASE_PATH until it has that line"
    fi
else
    as_owner bash -c "printf '# Written by Servers/install-station.sh (#100): the path the Quarry is served\n# under on this station, read at build time. A change means a rebuild.\nNEXT_PUBLIC_BASE_PATH=%s\n' '$BASE_PATH' > '$WEB_ENV'" || die "write $WEB_ENV"
    ok "written: NEXT_PUBLIC_BASE_PATH=$BASE_PATH"
fi

say "7/12 Jasper's venv ($REPO/.venv)"
if [ ! -x "$REPO/.venv/bin/python" ]; then
    if [ -x "$UV" ]; then
        as_owner bash -lc "cd '$REPO' && '$UV' venv --python 3.13 .venv" || die "uv venv"
    else
        as_owner bash -lc "cd '$REPO' && python3 -m venv .venv" || die "python3 -m venv"
    fi
    ok "created"
else
    ok "exists ($(as_owner "$REPO/.venv/bin/python" --version))"
fi
if [ -x "$UV" ]; then
    as_owner bash -lc "cd '$REPO' && '$UV' pip install -q --python .venv/bin/python -r jasper/requirements.txt" || die "uv pip install"
else
    as_owner bash -lc "cd '$REPO' && .venv/bin/python -m pip install -q -r jasper/requirements.txt" || die "pip install"
fi
as_owner "$REPO/.venv/bin/python" -c "import PIL, pillow_heif" || die "Jasper's packages did not import"
ok "pillow and pillow-heif present"

say "8/12 The database ($DB)"
ver=$(as_owner "$REPO/.venv/bin/python" -c "
import sys
sys.path.insert(0, '$REPO')
from jasper import db
conn = db.connect(sys.argv[1])
print(db.current_version(conn))
conn.close()
" "$DB") || die "could not create or migrate $DB"
ok "schema v$ver"

say "9/12 Web app: install + build (as $OWNER, through a login shell; about a minute on a J5005)"
as_owner bash -lc "cd '$REPO/web' && pnpm install --frozen-lockfile && pnpm build" >/tmp/quarry-build.log 2>&1 \
    || { tail -n 30 /tmp/quarry-build.log; die "web build failed (full log: /tmp/quarry-build.log)"; }
ok "built: BUILD_ID $(cat "$REPO/web/.next/BUILD_ID")"

say "10/12 Units"
changed=0
for u in quarry-web jasper quarry-autodeploy; do
    if ! cmp -s "$REPO/Servers/$u.service" "$SD/$u.service"; then
        install -m 0644 "$REPO/Servers/$u.service" "$SD/$u.service" || die "install $u.service"
        changed=1
        ok "$u.service installed"
    else
        ok "$u.service unchanged"
    fi
done
# The node-path drop-in exists for nvm, which systemd does not load. With
# node at /usr/bin the unit finds it on its own, and a drop-in left over from
# an earlier nvm would pin a directory that may not exist.
DROPIN="$SD/quarry-web.service.d/node-path.conf"
if [ "$NODE_UNDER_NVM" -eq 1 ]; then
    install -d "$SD/quarry-web.service.d"
    printf '# Written by Servers/install-station.sh: node lives under nvm, which systemd\n# does not load. Re-run the script after an nvm upgrade.\n[Service]\nEnvironment=PATH=%s:/usr/local/bin:/usr/bin:/bin\n' "$NODE_BIN" > /tmp/quarry-node-path.conf
    if ! cmp -s /tmp/quarry-node-path.conf "$DROPIN"; then
        install -m 0644 /tmp/quarry-node-path.conf "$DROPIN"
        changed=1
        ok "node-path.conf -> $NODE_BIN"
    else
        ok "node-path.conf unchanged"
    fi
    rm -f /tmp/quarry-node-path.conf
elif [ -f "$DROPIN" ]; then
    rm -f "$DROPIN"
    rmdir "$SD/quarry-web.service.d" 2>/dev/null
    changed=1
    ok "removed a stale node-path.conf (node is at $NODE_BIN, on the unit's own PATH)"
else
    ok "no node-path drop-in needed (node at $NODE_BIN)"
fi
systemctl daemon-reload || die "daemon-reload"
systemctl enable --quiet quarry-web jasper quarry-autodeploy || die "enable"
# The web app always restarts: step 9 just rebuilt it, and `next start`
# serves the build it loaded when it started.
systemctl restart quarry-web || die "restart quarry-web"
# The watcher always restarts too: it reads the channel from the env file
# only when it starts, and step 4 may have just written it.
systemctl restart quarry-autodeploy || die "restart quarry-autodeploy"
if has_key; then
    systemctl restart jasper || die "jasper"
    sleep 3
    if systemctl is-active --quiet jasper; then
        ok "jasper: $(journalctl -u jasper -n 1 --no-pager -o cat)"
    else
        journalctl -u jasper -n 10 --no-pager -o cat | sed 's/^/    /'
        die "jasper did not stay up (above: its last lines)"
    fi
else
    systemctl stop jasper 2>/dev/null
    warn "jasper not started: no key yet"
fi
# Under a base path the root is a 404 by design; the app answers at the path.
for i in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$BASE_PATH")" = 200 ] && break
    sleep 1
done
[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$BASE_PATH")" = 200 ] || die "quarry-web is not answering on :$PORT$BASE_PATH (journalctl -u quarry-web -n 30)"
ok "quarry-web answers on :$PORT$BASE_PATH"
sleep 1
watcher_line=$(journalctl -u quarry-autodeploy -n 1 --no-pager -o cat)
case "$watcher_line" in
    *"origin/$CHANNEL"*) ok "watcher: $watcher_line" ;;
    *) warn "watcher: $watcher_line (expected it to say origin/$CHANNEL)" ;;
esac

say "11/12 The door (http://127.0.0.1$BASE_PATH through this station's Caddy; checked, never written)"
door_ok=0
code=$(door_code)
if [ "$code" = 200 ]; then
    door_ok=1
    ok "the door answers: Caddy routes $BASE_PATH to :$PORT"
else
    warn "the door answers $code, not 200"
    if grep -q "^$BASE_PATH\b\|handle $BASE_PATH" "$CADDY_AVIARY" 2>/dev/null; then
        echo "    The Aviary's checkout has the route; the live $CADDY_LIVE does not yet. The sync is"
        echo "    the Aviary's hand step, not this script's:"
        echo "        caddy validate --config $CADDY_AVIARY --adapter caddyfile"
        echo "        sudo cp $CADDY_AVIARY $CADDY_LIVE && sudo systemctl reload caddy"
    else
        echo "    The Aviary's Caddyfile.station needs a route for $BASE_PATH to 127.0.0.1:$PORT"
        echo "    (reclinerhead/aviary#684). Once it is on the Aviary's station channel and synced"
        echo "    into $CADDY_LIVE on this box, re-run this script."
    fi
fi

say "12/12 Left for you"
left=0
if ! has_key; then
    echo "    - the gateway key: re-run this script and paste it when asked"
    left=1
fi
if ! has_mindat_key; then
    echo "    - the Mindat key (optional): re-run this script and paste it when asked"
    left=1
fi
if [ "$door_ok" -eq 0 ]; then
    echo "    - the door: the Caddy route above, then re-run this script"
    left=1
fi
echo "    - bookmarks and home-screen icons: the front door's address for this station,"
echo "      never this box's IP, which changes with the router's lease (#102)"
[ "$left" -eq 0 ] && ok "nothing else: open the front door's address on a phone on this house's Wi-Fi"
echo "    - any time: bash $REPO/Servers/check.sh"
