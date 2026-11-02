#!/usr/bin/env bash
# check.sh -- is the Quarry healthy on this box? No sudo. Reads the units, the
# port, the door, pearl's DNS record, the watcher's last lines and Jasper's
# last jobs (one line each, with what it cost).
#
#     bash ~/quarry/Servers/check.sh

REPO="${QUARRY_REPO:-$HOME/quarry}"
PEARL=192.168.1.64

line() { printf '%-24s %s\n' "$1" "$2"; }

echo "The Quarry on $(hostname), $(date '+%F %H:%M')"
line "checkout" "$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null) on $(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null) ($(git -C "$REPO" status --porcelain --untracked-files=no 2>/dev/null | wc -l) tracked changes)"
line "web build" "$(cat "$REPO/web/.next/BUILD_ID" 2>/dev/null || echo none) ($(stat -c %y "$REPO/web/.next/BUILD_ID" 2>/dev/null | cut -d. -f1))"
for u in quarry-web jasper quarry-autodeploy; do
    line "$u" "$(systemctl is-active "$u" 2>/dev/null) / $(systemctl is-enabled "$u" 2>/dev/null)"
done
line ":3020 (next)" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3020/)"
# -k on purpose: this line asks whether the door answers, and the box's own
# curl does not carry the house root certificate. --resolve sends the name to
# this box's Caddy without asking DNS, which here is orchid's standby Pi-hole
# and not kept in step with pearl's. A phone is the real test of both.
line "https://quarry.lan" "$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 --resolve quarry.lan:443:127.0.0.1 https://quarry.lan/ 2>/dev/null || echo unreachable)"
if command -v dig >/dev/null; then
    line "quarry.lan on pearl" "$(dig +short +time=2 +tries=1 @"$PEARL" quarry.lan A 2>/dev/null | head -n 1 | grep . || echo 'no record')"
fi
echo
echo "watcher, last 3 lines:"
journalctl -u quarry-autodeploy -n 3 --no-pager -o cat 2>/dev/null | sed 's/^/    /'
echo "jasper, last 5 lines:"
journalctl -u jasper -n 5 --no-pager -o cat 2>/dev/null | sed 's/^/    /'
