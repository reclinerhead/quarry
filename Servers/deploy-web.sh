#!/usr/bin/env bash
# deploy-web.sh -- THE way to deploy the Quarry's web app by hand.
#
# "git pull + systemctl restart" is not a deploy: `next start` serves the
# compiled .next/, not source, so a restart without a build re-serves the old
# code, and a build run after the restart rewrites .next/ under the live
# server. This script enforces the one valid order, pull -> install -> build
# -> restart, and set -e fails loudly at the first broken step, so a failed
# build never restarts the service. The watcher (autodeploy.sh) runs this same
# order on its own when a merge touches web/; this is the manual path.
#
# Run it on the box, as todd, from anywhere:  bash ~/quarry/Servers/deploy-web.sh

set -euo pipefail

REPO="${QUARRY_REPO:-$HOME/quarry}"

echo "==> git pull ($REPO)"
git -C "$REPO" pull --ff-only

cd "$REPO/web"

echo "==> pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile

echo "==> pnpm build"
pnpm build

echo "==> sudo systemctl restart quarry-web"
sudo systemctl restart quarry-web

echo "==> quarry-web is $(systemctl is-active quarry-web)"
