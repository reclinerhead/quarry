#!/usr/bin/env bash
# install-orchid.sh -- bring the Quarry up on orchid (issue #10), or bring it
# current after a change to a unit or to Caddyfile.quarry. Run WITH sudo, from
# anywhere:
#
#     sudo bash ~/quarry/Servers/install-orchid.sh
#
# The first time, clone the repo first (as todd, not root):
#
#     git clone https://github.com/reclinerhead/quarry.git ~/quarry && sudo bash ~/quarry/Servers/install-orchid.sh
#
# Idempotent: every step checks what is there and changes only what differs.
# It never touches the Aviary's or the Conservatory's units or watchers, and
# never the data directory's contents. What it does, in order:
#
#   1. preflight: the checkout, node under nvm, pnpm, uv (or python3), port 3020
#   2. the data directory outside the checkout, owned by todd
#   3. the environment file at /etc/quarry/quarry.env (copied from the example
#      when missing)
#   4. the keys: when the file has no gateway key, asks whether to use the
#      Conservatory's key or a new one; when it has no Mindat key (#18),
#      asks for one, and Enter skips it. Either is written without being
#      echoed or put on a command line
#   5. Jasper's venv (.venv/ in the checkout) and its packages
#   6. the database: created and migrated, so the web app has one before
#      Jasper's first job
#   7. the web app's install + build
#   8. the three units + the node-path drop-in, enabled and started
#   9. the door: Caddy's import of Caddyfile.quarry, synced from the Aviary's
#      Caddyfile-orchid and reloaded when you say yes
#  10. what is left for you
#
# Nothing here is a paste block: run it, read it, re-run it.

set -uo pipefail

OWNER=todd
REPO=/home/todd/quarry
DATA=/home/todd/quarry-data
ENVDIR=/etc/quarry
ENVF=$ENVDIR/quarry.env
SD=/etc/systemd/system
PORT=3020
CADDY_LIVE=/etc/caddy/Caddyfile
CADDY_AVIARY=/home/todd/project-squirrel/Servers/Caddyfile-orchid
CADDY_STAMP=$ENVDIR/Caddyfile.quarry.loaded
CONSERVATORY_ENV=/etc/conservatory/conservatory.env
PEARL=192.168.1.64
ORCHID=192.168.1.148

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

# Rewrite the NAME= line of $ENVF (AI_GATEWAY_API_KEY or MINDAT_API_KEY).
# Builtins only (printf and read are not processes), so the key never appears
# in any command's argv.
write_key() {
    local name="$1" key="$2" tmp line
    tmp=$(mktemp "$ENVDIR/.quarry.env.XXXXXX") || die "mktemp in $ENVDIR"
    while IFS= read -r line || [ -n "$line" ]; do
        if [[ "$line" == "$name="* ]]; then
            printf '%s=%s\n' "$name" "$key"
        else
            printf '%s\n' "$line"
        fi
    done < "$ENVF" > "$tmp"
    chmod 0600 "$tmp" && mv "$tmp" "$ENVF" || die "could not write $ENVF"
}

has_key() { [ -n "$(env_value AI_GATEWAY_API_KEY "$ENVF")" ]; }

[ "$(id -u)" -eq 0 ] || die "run with sudo: sudo bash $REPO/Servers/install-orchid.sh"

say "1/10 Preflight"
[ -d "$REPO/.git" ] || die "no checkout at $REPO (as $OWNER: git clone https://github.com/reclinerhead/quarry.git $REPO)"
[ "$(stat -c %U "$REPO")" = "$OWNER" ] || die "$REPO is not owned by $OWNER"
ok "checkout at $(as_owner git -C "$REPO" rev-parse --short HEAD) on $(as_owner git -C "$REPO" rev-parse --abbrev-ref HEAD)"
NODE_BIN=$(ls -d /home/$OWNER/.nvm/versions/node/v2[4-9]*/bin 2>/dev/null | sort -V | tail -n 1)
[ -n "$NODE_BIN" ] && [ -x "$NODE_BIN/node" ] || die "no Node 24+ under /home/$OWNER/.nvm (node:sqlite needs it)"
as_owner bash -lc "command -v pnpm >/dev/null" || die "pnpm is not on $OWNER's login PATH (the Aviary's build needs it too; check ~/.profile)"
ok "node $("$NODE_BIN/node" --version) at $NODE_BIN; pnpm on the login PATH"
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
for u in aviary-web aviary-autodeploy conservatory-web fern conservatory-autodeploy; do
    systemctl is-active --quiet "$u" && ok "$u is running and stays untouched"
done

say "2/10 Data directory ($DATA, outside the checkout)"
if [ ! -d "$DATA" ]; then
    install -d -o "$OWNER" -g "$OWNER" -m 0755 "$DATA" || die "mkdir $DATA"
    ok "created"
else
    ok "exists"
fi
[ "$(stat -c %U "$DATA")" = "$OWNER" ] || die "$DATA is not owned by $OWNER"
as_owner mkdir -p "$DATA/photos"

say "3/10 Environment file ($ENVF)"
install -d -m 0755 "$ENVDIR"
if [ ! -f "$ENVF" ]; then
    install -m 0600 -o root -g root "$REPO/Servers/quarry.env.example" "$ENVF" || die "copy the example"
    ok "created from the example"
else
    ok "exists (left as is)"
fi
chmod 0600 "$ENVF"
for v in QUARRY_DB QUARRY_DATA AI_GATEWAY_API_KEY; do
    grep -q "^$v=" "$ENVF" || die "$ENVF lacks a $v= line (compare it with Servers/quarry.env.example)"
done
# Mindat is optional (#18), so a file from before it gets the line added rather than a stop.
if ! grep -q "^MINDAT_API_KEY=" "$ENVF"; then
    printf '\n# OpenMindat API key (mindat.org). Jasper only, and optional.\nMINDAT_API_KEY=\n' >> "$ENVF" || die "could not add MINDAT_API_KEY= to $ENVF"
    ok "added an empty MINDAT_API_KEY= line (step 4 asks for it)"
fi
DB=$(env_value QUARRY_DB "$ENVF")
[ -n "$DB" ] || die "QUARRY_DB is empty in $ENVF"

say "4/10 The keys"
if has_key; then
    ok "AI_GATEWAY_API_KEY is set (left as is; to change it: sudoedit $ENVF, then sudo systemctl restart jasper)"
elif [ ! -t 0 ]; then
    warn "AI_GATEWAY_API_KEY is empty and nobody is at the keyboard to ask; Jasper waits for it"
else
    house_key=$(env_value AI_GATEWAY_API_KEY "$CONSERVATORY_ENV" || true)
    echo "    Jasper needs a Vercel AI Gateway key. Which one?"
    if [ -n "$house_key" ]; then
        echo "      1) the Conservatory's key (one bill for the house's apps)"
    else
        echo "      1) (the Conservatory has no key to share)"
    fi
    echo "      2) a new key just for the Quarry (its spend shows on its own in the gateway's dashboard)"
    echo "      3) not now (everything else comes up; Jasper waits)"
    read -r -p "    1, 2 or 3: " choice
    case "$choice" in
        1)
            [ -n "$house_key" ] || die "the Conservatory's env file has no key to share; re-run and pick 2"
            write_key AI_GATEWAY_API_KEY "$house_key"
            ok "the Conservatory's key is now the Quarry's too"
            ;;
        2)
            read -r -s -p "    Paste the key (it will not show), then Enter: " new_key
            echo
            [ -n "$new_key" ] || die "no key entered; re-run when you have it"
            [[ "$new_key" =~ [[:space:]] ]] && die "that key has a space in it; re-run and paste it again"
            write_key AI_GATEWAY_API_KEY "$new_key"
            ok "the new key is in $ENVF"
            ;;
        *)
            warn "no key yet; re-run this script when you have one"
            ;;
    esac
    unset house_key new_key
fi
has_mindat_key() { [ -n "$(env_value MINDAT_API_KEY "$ENVF")" ]; }
if has_mindat_key; then
    ok "MINDAT_API_KEY is set (left as is; to change it: sudoedit $ENVF, then sudo systemctl restart jasper)"
elif [ ! -t 0 ]; then
    warn "MINDAT_API_KEY is empty and nobody is at the keyboard to ask; Jasper matches candidates by name only"
else
    echo "    With a Mindat key, Jasper looks each suggestion up in Mindat, so two names for"
    echo "    one stone (Quartz and Chalcedony, both saying agate) count as agreeing. Optional."
    read -r -s -p "    Paste the Mindat API key (it will not show), or just Enter to skip: " mindat_key
    echo
    if [ -z "$mindat_key" ]; then
        warn "no Mindat key; candidates are matched by name only (re-run this script to add one)"
    elif [[ "$mindat_key" =~ [[:space:]] ]]; then
        die "that key has a space in it; re-run and paste it again"
    else
        write_key MINDAT_API_KEY "$mindat_key"
        ok "the Mindat key is in $ENVF"
    fi
    unset mindat_key
fi

say "5/10 Jasper's venv ($REPO/.venv)"
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

say "6/10 The database ($DB)"
ver=$(as_owner "$REPO/.venv/bin/python" -c "
import sys
sys.path.insert(0, '$REPO')
from jasper import db
conn = db.connect(sys.argv[1])
print(db.current_version(conn))
conn.close()
" "$DB") || die "could not create or migrate $DB"
ok "schema v$ver"

say "7/10 Web app: install + build (as $OWNER, through a login shell)"
as_owner bash -lc "cd '$REPO/web' && pnpm install --frozen-lockfile && pnpm build" >/tmp/quarry-build.log 2>&1 \
    || { tail -n 30 /tmp/quarry-build.log; die "web build failed (full log: /tmp/quarry-build.log)"; }
ok "built: BUILD_ID $(cat "$REPO/web/.next/BUILD_ID")"

say "8/10 Units"
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
install -d "$SD/quarry-web.service.d"
DROPIN="$SD/quarry-web.service.d/node-path.conf"
printf '# Written by Servers/install-orchid.sh: node lives under nvm, which systemd\n# does not load. Re-run the script after an nvm upgrade.\n[Service]\nEnvironment=PATH=%s:/usr/local/bin:/usr/bin:/bin\n' "$NODE_BIN" > /tmp/quarry-node-path.conf
if ! cmp -s /tmp/quarry-node-path.conf "$DROPIN"; then
    install -m 0644 /tmp/quarry-node-path.conf "$DROPIN"
    changed=1
    ok "node-path.conf -> $NODE_BIN"
else
    ok "node-path.conf unchanged"
fi
rm -f /tmp/quarry-node-path.conf
systemctl daemon-reload || die "daemon-reload"
systemctl enable --quiet quarry-web jasper quarry-autodeploy || die "enable"
# The web app always restarts: step 7 just rebuilt it, and `next start`
# serves the build it loaded when it started.
systemctl restart quarry-web || die "restart quarry-web"
if [ "$changed" -eq 1 ]; then
    systemctl restart quarry-autodeploy || die "restart quarry-autodeploy"
else
    systemctl start quarry-autodeploy || die "start quarry-autodeploy"
fi
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
for i in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")" = 200 ] && break
    sleep 1
done
[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/")" = 200 ] || die "quarry-web is not answering on :$PORT (journalctl -u quarry-web -n 30)"
ok "quarry-web answers on :$PORT"
ok "watcher: $(journalctl -u quarry-autodeploy -n 1 --no-pager -o cat)"

say "9/10 The door (https://quarry.lan through orchid's Caddy)"
IMPORT_LINE="import $REPO/Servers/Caddyfile.quarry"
door_ok=0
reload_caddy() {
    caddy adapt --config "$CADDY_LIVE" --adapter caddyfile >/dev/null 2>/tmp/quarry-caddy.log \
        || { cat /tmp/quarry-caddy.log; return 1; }
    systemctl reload caddy || return 1
    install -m 0644 "$REPO/Servers/Caddyfile.quarry" "$CADDY_STAMP"
}
if grep -qxF "$IMPORT_LINE" "$CADDY_LIVE" 2>/dev/null; then
    if cmp -s "$REPO/Servers/Caddyfile.quarry" "$CADDY_STAMP"; then
        ok "Caddy imports Caddyfile.quarry, and has loaded this copy of it"
    elif reload_caddy; then
        ok "Caddyfile.quarry changed since Caddy last loaded it: checked and reloaded"
    else
        warn "Caddy refused the config and keeps serving the old one (above); fix Caddyfile.quarry and re-run"
    fi
elif grep -qxF "$IMPORT_LINE" "$CADDY_AVIARY" 2>/dev/null; then
    echo "    The Aviary's Caddyfile-orchid imports the Quarry's door; the live $CADDY_LIVE does not yet."
    echo "    Syncing it copies the whole file. What would change:"
    diff -u "$CADDY_LIVE" "$CADDY_AVIARY" | sed 's/^/      /'
    if [ -t 0 ]; then
        read -r -p "    Copy it into place and reload Caddy? [y/N] " yn
    else
        yn=n
    fi
    if [ "$yn" = y ] || [ "$yn" = Y ]; then
        cp -p "$CADDY_LIVE" "$CADDY_LIVE.before-quarry" || die "back up $CADDY_LIVE"
        if caddy adapt --config "$CADDY_AVIARY" --adapter caddyfile >/dev/null 2>/tmp/quarry-caddy.log; then
            cp "$CADDY_AVIARY" "$CADDY_LIVE" || die "copy $CADDY_AVIARY"
            if reload_caddy; then
                ok "synced and reloaded (the previous file is $CADDY_LIVE.before-quarry)"
            else
                cp -p "$CADDY_LIVE.before-quarry" "$CADDY_LIVE"
                warn "Caddy refused the reload; the previous file is back in place and Caddy keeps serving it"
            fi
        else
            cat /tmp/quarry-caddy.log
            warn "the Aviary's Caddyfile-orchid does not parse; nothing was copied"
        fi
    else
        warn "left as is; re-run when you want the door open"
    fi
else
    warn "the Aviary's Caddyfile-orchid ($CADDY_AVIARY) does not import the Quarry's door yet"
fi
code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 --resolve "quarry.lan:443:127.0.0.1" https://quarry.lan/ 2>/dev/null)
if [ "$code" = 200 ]; then
    door_ok=1
    ok "https://quarry.lan answers through Caddy (checked on this box, without DNS)"
else
    warn "https://quarry.lan does not answer through Caddy yet ($code)"
fi

say "10/10 Left for you"
left=0
if ! has_key; then
    echo "    - the gateway key: re-run this script, and pick 1 or 2"
    left=1
fi
if ! has_mindat_key; then
    echo "    - the Mindat key (optional): re-run this script and paste it when asked"
    left=1
fi
if [ "$door_ok" -eq 0 ] && ! grep -qxF "$IMPORT_LINE" "$CADDY_AVIARY" 2>/dev/null; then
    echo "    - the door: the Aviary's Caddyfile-orchid needs this line at its end (a one-line PR in project-squirrel):"
    echo "          $IMPORT_LINE"
    echo "      once it merges and the Aviary's watcher has pulled it, re-run this script"
    left=1
fi
dns=""
command -v dig >/dev/null && dns=$(dig +short +time=2 +tries=1 @"$PEARL" quarry.lan A 2>/dev/null | head -n 1)
if [ "$dns" != "$ORCHID" ]; then
    echo "    - DNS: in pearl's Pi-hole admin, Local DNS -> DNS Records, add quarry.lan -> $ORCHID"
    [ -z "$(command -v dig)" ] && echo "      (no dig on this box to check; skip this if it is already there)"
    left=1
fi
[ "$left" -eq 0 ] && ok "nothing: open https://quarry.lan on a phone on the house Wi-Fi"
echo "    - any time: bash $REPO/Servers/check.sh"
