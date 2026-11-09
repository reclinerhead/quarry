# Running it at the house, and at a station

What runs where, how to check it, and how to put it back. Everything the box executes lives in `Servers/`. Nothing in this spoke is a paste block: each job on the box is a script you run and read. The Quarry runs in two shapes:

- **At the house, on orchid**, beside the Aviary and the Conservatory, for phones on the house Wi-Fi, as **`https://quarry.lan`**. It follows `main`: merging a PR is the deploy.
- **At a station** (birdhouse, kestrel), a Dell Wyse 5070 already in a relative's house running the Aviary, as **`http://<the box>/quarry`** on the box's one origin. It follows the release channel, `quarry-station-stable`: main with a delay, moved once nightly. Its door is the Aviary's Caddy, its key is its own, and it is two hours from a keyboard, so everything here that touches a station is built to need nobody at one.

The middle is the same on every box: the same three units, the same ports, the same data directory, the same environment file, the same watcher. The ends differ, keys and door, and each box has its own install script for them.

## What runs, on every box

| Unit | Runs | As | From | Port |
| --- | --- | --- | --- | --- |
| `quarry-web` | `next start`, the production build of `web/` | todd | `~/quarry/web` | 3020, loopback only |
| `jasper` | `python -m jasper`, the identification worker | todd | `~/quarry`, venv `.venv/` (uv, Python 3.13) | |
| `quarry-autodeploy` | `Servers/autodeploy.sh`, the deploy watcher | root (steps demoted to todd) | `~/quarry` | |

3020 is the Quarry's port everywhere. The other ports on orchid are 3000 (the Aviary), 3010 (the Conservatory) and 3100 (Ingenia); on a station, 3000 (the Aviary) and 3010 (the Conservatory, in spring). The web unit listens on 127.0.0.1 only, and Caddy is the one way in.

**The data lives outside the checkout**, in `/home/todd/quarry-data/`: the one SQLite file and the photo tree (`photos/yyyy/mm/`, with Jasper's thumbnails beside the originals). A deploy can never reach it.

**The environment file.** All three units read `/etc/quarry/quarry.env`:

- It is root-owned, mode 0600. systemd reads it before dropping to todd.
- It holds `QUARRY_DB`, `QUARRY_DATA` and `AI_GATEWAY_API_KEY`, and optionally the two model slugs and `MINDAT_API_KEY`.
- On a station it also holds `QUARRY_DEPLOY_BRANCH=quarry-station-stable`, which tells the watcher which branch to follow. Orchid's file has no such line, and the watcher's default is `main`.
- The keys are in that file and nowhere else. Jasper will not start without the gateway key; without the Mindat key it matches candidates by name only. The web unit never calls a model.

**One value is not in that file**: `NEXT_PUBLIC_BASE_PATH`, the path the web app is served under (`/quarry` on a station, unset on orchid; `web.md`). It is read at build time, so it lives in `web/.env.local`, owned by todd, beside the build. The root-only env file would be the wrong place: the build runs as todd, who cannot read it.

## The door

**On orchid**, Caddy fronts the app as `https://quarry.lan` (`Servers/Caddyfile.quarry`):

- **The block** is one site block, which orchid's Caddyfile imports.
- **`lan_tls`** is the house snippet. It brings the house's private root, HSTS and compression.
- **The name** is a Pi-hole Local DNS record on pearl, pointing at orchid (`192.168.1.148`). The Launchpad's Quarry tile already points there.

**On a station**, there are no names: Caddy answers on `:80` whatever the visitor typed and the Aviary owns the file. The Aviary's `Servers/Caddyfile.station` carries a `handle /quarry*` route to `127.0.0.1:3020` (reclinerhead/aviary#684), written into the file rather than imported, so a missing Quarry can never take the Aviary down with it: a route to a silent port is a 502 on that path and nothing else. `handle`, not `handle_path`, because the app is built for the prefix (#100). The file is synced by hand on each station, the Aviary's posture for every Caddy change:

```
caddy validate --config ~/aviary/Servers/Caddyfile.station --adapter caddyfile
sudo cp ~/aviary/Servers/Caddyfile.station /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

No script in this repo writes `/etc/caddy/` on any box. Orchid's install script syncs orchid's file after showing the diff and asking; the station's install script only checks the door and tells you what is missing.

## The front door

A station has no name on its LAN: its address is whatever the router handed it, so a bookmark to `http://192.168.1.120/quarry` breaks at the next lease. The bookmark is a stable public address that redirects to the box's current one: **`https://quarry.toddtech.llc/<station>`**, a small Vercel project of route handlers under `frontdoor/` (#102), the Quarry's copy of the Aviary's `aviary.toddtech.llc/<station>` (copied, not shared, the house rule).

| Route | Answer |
| --- | --- |
| `/<station>[/path]` | `302` to `http://<the box's last-known LAN address>/quarry[/path]`, query string carried, `Cache-Control: no-store`. An unknown name or a station that has never reported gets a plain 404 page, no redirect. |
| `/<station>/status` | When the box last checked in, its address, its Wi-Fi interface and the Aviary's build on it: the one page that answers "is her box up" from a desk, and the text message that replaces a lost bookmark. |
| `/` | A landing page that lists nothing. |

**It reads the Aviary's store and writes nothing.** The stations already report themselves to the Aviary's front door (`station-checkin` posts the Wi-Fi interface's private address to `aviary.toddtech.llc/api/checkin` on boot, every fifteen minutes and on every new lease; reclinerhead/aviary `docs/guide/flyway.md` § The front door). That door keeps one JSON record per station in an Upstash Redis database, and this project is a second, read-only client of the same database: the Aviary's Vercel project and this one share the database through the Marketplace integration, and this one is given the read-only token. So there is no check-in route here, no roster, no token, no new unit on a station and no new credential anywhere; enrolling a station in this door is nothing, because a station that reports to the Aviary's is on it. The record's shape and key (`station:<id>`) are the Aviary's to change. Should the Aviary's check-in ever stop, this door keeps answering with the last address it saw, which stays right until the router changes it.

**302 and `no-store`, never 301.** A cached permanent redirect would bake the LAN address into the browser, the exact failure the door exists to end. The redirect goes to the last-known address regardless of the record's age: a station whose internet is down is in a house whose internet is down, and the address is still the best guess. The target is built from a validated IPv4 and a fixed `/quarry` prefix, each path segment percent-encoded, dot and empty segments refused, so a crafted link can never send a person off the station's own origin (`frontdoor/lib/frontdoor.ts`, tested in `frontdoor.test.ts`).

**The bookmark rule.** Bookmarks and home-screen icons at a station point at the front door's address for that station, `https://quarry.toddtech.llc/<station>`, never at the IP, and **Todd sets them** on deployment day. A person who bookmarks after landing has bookmarked the IP again. The link only works from that house's Wi-Fi (a private address is unreachable from anywhere else, so the icon from a car fails to connect) and lands on plain HTTP on the LAN, like the Aviary's; the "Not secure" label is the one the IP bookmark showed.

**The Vercel project** is `frontdoor/`'s own: Root Directory `frontdoor`, an Ignored Build Step that skips any merge not touching that folder, the Aviary's Upstash database connected, and the domain, whose DNS record Vercel makes itself because `toddtech.llc` is on Vercel's nameservers. The steps, in order, are in `frontdoor/README.md`, including the one that bit on day one: the import deploys before the database is connected, and a function's environment is fixed at build, so a second deploy is part of the setup. Nothing on a box deploys to Vercel; the boxes pull from GitHub as described below, and the watcher ignores `frontdoor/` as it ignores the docs.

## Deploys

The watcher, `quarry-autodeploy`, polls the configured branch every 60 s over anonymous https. The repo is public, so there is no key on any box. When the branch moves, it pulls `--ff-only` and acts on what changed:

| Changed | It does |
| --- | --- |
| `jasper/` | Installs if `jasper/requirements.txt` changed (uv into the venv), then restarts `jasper`. A schema migration runs as Jasper starts, before the web app's new build serves. |
| `web/`, or `design/tokens.css` | `pnpm install` and `pnpm build`, then restarts `quarry-web` **only if the build passed**. A failed build is a loud journal line, and the old build keeps serving. `globals.css` imports the tokens, which is why they count. |
| `Servers/autodeploy.sh` | Hands over to the new copy. |
| A unit or `Caddyfile.quarry` | Logs that the next run of the box's install script applies it. |
| Anything else | Nothing (docs, tests, the spikes, the design brief, `frontdoor/`, which deploys to Vercel and never to a box). |

**Which branch.** `QUARRY_DEPLOY_BRANCH` in the env file, default `main`. The watcher's first journal line says which: `watching origin/main` on orchid, `watching origin/quarry-station-stable` on a station.

**The release channel.** `quarry-station-stable` is not a fork. It is fast-forward-only, never committed to, always an ancestor of main. `.github/workflows/promote-stations.yml` moves it to main's tip once nightly at 07:20 UTC (02:20 or 03:20 Eastern, twenty minutes after the Aviary's promotion, so two builds never start in the same minute on a J5005). If the branch cannot fast-forward, something was committed to it directly, and the run fails red rather than papering over it. The emergency path, when a fix cannot wait for tonight: merge it to main, then `gh workflow run promote-stations.yml` (or Actions, Promote stations, Run workflow, from a phone). The stations deploy within a minute. The branch was created once from main's tip:

```
git fetch origin && git push origin origin/main:refs/heads/quarry-station-stable
```

How the watcher behaves, on every box:

- **Quiet ticks log nothing,** so `journalctl -u quarry-autodeploy` reads as a deploy history and silence is healthy.
- **A dirty checkout** (tracked changes) is skipped loudly until cleaned.
- **Checking out a branch** on the box pauses deploys, and checking the configured branch back out resumes them. Pinned means off the *configured* branch: a station checkout sitting on `main` is a half-finished channel flip and pauses the same way.
- **By hand:** `Servers/deploy-web.sh` deploys the web app in the one valid order (pull, install, build, restart). `autodeploy.sh --once` is a single tick.

**Two things a deploy never does:**

- **Change Caddy.** Orchid's install script applies a change to `Caddyfile.quarry`; a station's Caddyfile is the Aviary's, synced by hand.
- **Change the environment file.** A variable added to the example reaches the box only by hand: add the line to `/etc/quarry/quarry.env` with `sudoedit`, then restart the units. They read the file only when they start.

## Bring-up, and after a change to the units or the door

Each box has one install script. Both are idempotent, run with sudo, and end by listing what is left. The first time, as todd, clone and run:

```
git clone https://github.com/reclinerhead/quarry.git ~/quarry && sudo bash ~/quarry/Servers/install-orchid.sh
```

or on a station:

```
git clone https://github.com/reclinerhead/quarry.git ~/quarry && sudo bash ~/quarry/Servers/install-station.sh
```

**What they share**, the middle: the data directory; the env file from `Servers/quarry.env.example` when missing; the keys, asked for when the file has none, written with shell builtins so they are never echoed and never on a command line; Jasper's venv; the database, created or migrated through `jasper.db` so the web app has one before Jasper's first job; the web build; the three units, enabled and started. Re-running the script is how a key reaches a box later, and how a changed unit is applied.

**`install-orchid.sh`**, the house's ends:

- **Node under nvm.** systemd does not load nvm, so the script writes the `node-path.conf` drop-in pinning the web unit's `PATH` to the versioned bin. Re-run it after an nvm upgrade.
- **The gateway key** is a choice: the Conservatory's key (one bill for the house's apps) or a key of the Quarry's own.
- **The door.** Orchid's Caddy config is the Aviary's: `project-squirrel/Servers/Caddyfile-orchid` is the canonical copy, `/etc/caddy/Caddyfile` the live one. The canonical copy carries `import /home/todd/quarry/Servers/Caddyfile.quarry`, put there by a PR in that repo and pulled onto orchid by the Aviary's watcher. When the script sees the line in the Aviary's checkout but not in the live file, it shows the diff, asks, parses the new config with `caddy adapt`, keeps a `.before-quarry` copy and reloads. After a later change to `Caddyfile.quarry` it reloads Caddy on its next run, comparing the file with the copy it last loaded (kept in `/etc/quarry/`).
- **DNS**: checks pearl's record for `quarry.lan` when `dig` is installed.

**`install-station.sh`**, the station's ends:

- **Node wherever todd's login shell finds it**: `/usr/bin/node` from NodeSource on a station, so no drop-in is written, and a stale one from an earlier nvm is removed. A box with nvm gets the drop-in as orchid does. No nvm is not an error.
- **The channel.** A checkout on `main` is moved to `quarry-station-stable` (fetched first), so the box is never half-flipped. `QUARRY_DEPLOY_BRANCH=quarry-station-stable` is written into the env file, added if a hand-written file lacks it. The watcher is restarted so it reads it.
- **One key per station**, pasted, with its own spend limit in the gateway's dashboard, so a runaway on one box cannot spend another's budget. There is no house key to offer. The Mindat key may be shared between boxes.
- **`web/.env.local`** with `NEXT_PUBLIC_BASE_PATH=/quarry`, written only if absent, so a hand edit survives.
- **The door is checked, never written.** `curl http://127.0.0.1/quarry` through the station's Caddy: 200 means open; anything else, and the script says whether the Aviary's checkout already has the route (then the sync above is the missing step) or does not yet (then reclinerhead/aviary#684 is), and stops short of `/etc/caddy`.
- **The Aviary's units, env file, watcher and checkout** are read for the preflight and never touched.

## Checking it

`bash ~/quarry/Servers/check.sh` prints:

- the role (house or station), the checkout and the build id; on a station, the channel's tip as last fetched and when;
- each unit's state;
- the answer on `:3020` (at `/quarry` on a station, where the root is a 404 by design);
- the answer at the door: on orchid `https://quarry.lan` through this box's Caddy without DNS (orchid's standby Pi-hole is not kept in step with pearl's); on a station `http://127.0.0.1/quarry`;
- on orchid, pearl's record for `quarry.lan`, when `dig` is installed;
- the watcher's last lines, and Jasper's.

The script runs without sudo, so it cannot read the env file; it reads the role off the checkout's branch, which the install script keeps in step with the env file. Run with sudo, it reads the file.

**Jasper's journal** has one line per job, with what each model said, how long each took, what the job cost, and the Mindat part when Mindat was asked:

```
job 7 identified: haiku Galena 0.82 (5.8 s) · flash Galena 0.90 (4.1 s) · $0.0041 · mindat cached (0.0 s) · 6.2 s
```

- The models alone take 6 to 11 s. A job's Mindat lookups are held to about 4 s (#40); `mindat stopped: …` means Mindat was slow or down and the idle pass will fill the ids in.
- Between jobs, `mindat counted where 5 record(s) are found` is the idle pass counting places for the stone pages' "Where it's found" (#65), three requests a record, again each month. A household's first counts take a few minutes of passes; `catch-up stopped: api.mindat.org … 504` means Mindat is overloaded (or, most often, slow on a term's first search), and Mindat's pass tries again after the wait the line names, a minute doubling to ten until a pass completes (#119); `wikipedia fetched 3 page(s), 1 with no article` is Wikipedia's pass, run first on the same tick and on its own clock, fetching each name's lead for the stone pages' About card (#92), once a name.

- A model that did not answer makes it a WARNING.
- A job that failed for good, such as a bad key, is an ERROR.
- A spent gateway budget pauses Jasper for ten minutes and says until when. On a station, whose key has a monthly budget of its own, this is the line that says the budget tripped.
- On start it names both models and the prompt version.
- A photo costs about 0.4¢ for both models together: four came to 1.6¢ in #9's check. The gateway's dashboard has the bill, per key, so a station's spend reads apart from the house's.

**From a phone on the house Wi-Fi**, `https://quarry.lan` should show the collection. The first visit needs the house root certificate installed: the same one the Aviary's and the Conservatory's doors use. **From a phone on a station's Wi-Fi**, `https://quarry.toddtech.llc/<station>` lands on `http://<the box>/quarry`, plain http on the LAN, like the Aviary's; `https://quarry.toddtech.llc/<station>/status` says when the box last reported and from which address, from anywhere (The front door, above).

**Reaching a station**: `ssh birdhouse`, `ssh kestrel`, over the tailnet. A station is tagged and reaches nothing on the tailnet itself. `sudo` there asks for a password, so a root step is a script you run in that session, never something run for you. The box's own bring-up (the OS, Caddy, the Aviary) is `toddtech-infrastructure/servers/Birdhouse.md`; this guide covers the Quarry on it.

## Backups

The database is a WAL file with a writer that holds it open, so `cp` gives you a stale copy with no error. `Servers/backup.sh` uses the sqlite backup API, which reads through the WAL:

- It writes `~/backups/quarry-<date>.db`.
- It prints a quick_check and the row counts.

The photos and their thumbnails are plain files: copy `quarry-data/photos/` beside the backup. Off the box, monthly, and before any migration step. A station's backup stays on the box until Phase 4's courier exists; the Aviary's bird records there are in the same position.

## Rolling back

- **A bad merge of code:** fix forward.
  - Revert the merge on main, and orchid's watcher deploys the revert within a minute. The stations get it at the next nightly promotion, or at once with `gh workflow run promote-stations.yml`.
  - A web build that fails never restarts the unit, so a type error CI could not see leaves the previous build serving.
- **A unit that will not start:** `journalctl -u <unit> -n 50`. The usual causes:
  - **an empty or wrong key** (Jasper). It exits 2 and systemd does not retry, so fix the file and restart it;
  - **a node path that moved under nvm** (the web app, on orchid). Re-run the install script;
  - **a missing environment file.** The watcher needs it too.
- **A station that deploys nothing:** its checkout is off `quarry-station-stable` (`check.sh` shows the branch), or the channel has not moved. The watcher's journal says which.
- **Data:** restore the newest backup to `QUARRY_DB` with both units stopped (`sudo systemctl stop jasper quarry-web`), and expect to lose what was recorded since. A restore is for a lost or corrupt file, never for a change of mind.
- **The door:** on orchid, `/etc/caddy/Caddyfile.before-quarry` is the live file from before the install script first synced it. On a station, the Aviary's previous `Caddyfile.station`.
- **A leaked station key:** delete it in the gateway's dashboard (that box stops identifying, the others do not), create a new one, `sudoedit /etc/quarry/quarry.env` on the box and `sudo systemctl restart jasper`.
- **Everything off:** `sudo systemctl disable --now quarry-web jasper quarry-autodeploy`. The Aviary and the Conservatory do not notice.
