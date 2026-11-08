#!/usr/bin/env bash
# check.sh -- is the Quarry healthy on this box? No sudo. Reads the units, the
# port, the door, the watcher's last lines and Jasper's last jobs (one line
# each, with what it cost). On orchid it also asks pearl for the DNS record;
# on a station it names the channel and when it last moved.
#
#     bash ~/quarry/Servers/check.sh
#
# The role: the deploy watcher follows QUARRY_DEPLOY_BRANCH from
# /etc/quarry/quarry.env (#101), which is root-only, so without sudo this
# script reads the role off the checkout instead. The install script keeps
# the two in step: a station's checkout sits on quarry-station-stable, and
# the watcher deploys nothing while they disagree.

REPO="${QUARRY_REPO:-$HOME/quarry}"
PEARL=192.168.1.64
CHANNEL=quarry-station-stable

line() { printf '%-24s %s\n' "$1" "$2"; }

branch=$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null)
role=house
deploy_branch=$(sed -n 's/^QUARRY_DEPLOY_BRANCH=//p' /etc/quarry/quarry.env 2>/dev/null)
if [ "${deploy_branch:-$branch}" = "$CHANNEL" ]; then role=station; fi
if [ "$role" = station ]; then BASE=/quarry; else BASE=; fi

echo "The Quarry on $(hostname), $(date '+%F %H:%M') ($role)"
line "checkout" "$(git -C "$REPO" rev-parse --short HEAD 2>/dev/null) on $branch ($(git -C "$REPO" status --porcelain --untracked-files=no 2>/dev/null | wc -l) tracked changes)"
if [ "$role" = station ]; then
    # The channel's tip as this box last fetched it, and when that fetch was.
    # The tip moves once nightly (the promote-stations Action) or by hand.
    tip=$(git -C "$REPO" log -1 --format='%h, committed %cd' --date=format:'%F %H:%M' "origin/$CHANNEL" 2>/dev/null || echo unknown)
    line "channel" "origin/$CHANNEL at $tip"
    line "last fetch" "$(stat -c %y "$REPO/.git/FETCH_HEAD" 2>/dev/null | cut -d. -f1 || echo never)"
fi
line "web build" "$(cat "$REPO/web/.next/BUILD_ID" 2>/dev/null || echo none) ($(stat -c %y "$REPO/web/.next/BUILD_ID" 2>/dev/null | cut -d. -f1))"
for u in quarry-web jasper quarry-autodeploy; do
    line "$u" "$(systemctl is-active "$u" 2>/dev/null) / $(systemctl is-enabled "$u" 2>/dev/null)"
done
line ":3020 (next)" "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3020$BASE")"
if [ "$role" = station ]; then
    # Plain http on the station's one origin: Caddy on :80 routes /quarry to
    # :3020 (the Aviary's Caddyfile.station, reclinerhead/aviary#684).
    line "http://<this box>/quarry" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1/quarry 2>/dev/null || echo unreachable)"
else
    # -k on purpose: this line asks whether the door answers, and the box's own
    # curl does not carry the house root certificate. --resolve sends the name to
    # this box's Caddy without asking DNS, which here is orchid's standby Pi-hole
    # and not kept in step with pearl's. A phone is the real test of both.
    line "https://quarry.lan" "$(curl -sk -o /dev/null -w '%{http_code}' --max-time 5 --resolve quarry.lan:443:127.0.0.1 https://quarry.lan/ 2>/dev/null || echo unreachable)"
    if command -v dig >/dev/null; then
        line "quarry.lan on pearl" "$(dig +short +time=2 +tries=1 @"$PEARL" quarry.lan A 2>/dev/null | head -n 1 | grep . || echo 'no record')"
    fi
fi
echo
echo "watcher, last 3 lines:"
journalctl -u quarry-autodeploy -n 3 --no-pager -o cat 2>/dev/null | sed 's/^/    /'
echo "jasper, last 5 lines:"
journalctl -u jasper -n 5 --no-pager -o cat 2>/dev/null | sed 's/^/    /'
