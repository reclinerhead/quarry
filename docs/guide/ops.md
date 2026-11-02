# Running it at the house

What runs where, how to check it, and how to put it back. Everything the box executes lives in `Servers/`. Nothing in this spoke is a paste block: each job on the box is a script you run and read. The field stations wait for Phase 4. Today the Quarry runs on **orchid**, beside the Aviary and the Conservatory, for phones on the house Wi-Fi.

## What runs on orchid

| Unit | Runs | As | From | Port |
| --- | --- | --- | --- | --- |
| `quarry-web` | `next start`, the production build of `web/` | todd | `~/quarry/web` | 3020, loopback only |
| `jasper` | `python -m jasper`, the identification worker | todd | `~/quarry`, venv `.venv/` (uv, Python 3.13) | |
| `quarry-autodeploy` | `Servers/autodeploy.sh`, the deploy watcher | root (steps demoted to todd) | `~/quarry` | |

The other ports on orchid are 3000 (the Aviary), 3010 (the Conservatory) and 3100 (Ingenia). The web unit listens on 127.0.0.1 only. Caddy fronts it as **`https://quarry.lan`** (`Servers/Caddyfile.quarry`), so the door is the one way in:

- **The block** is one site block, which orchid's Caddyfile imports.
- **`lan_tls`** is the house snippet. It brings the house's private root, HSTS and compression.
- **The name** is a Pi-hole Local DNS record on pearl, pointing at orchid (`192.168.1.148`). The Launchpad's Quarry tile already points there.

**The data lives outside the checkout**, in `/home/todd/quarry-data/`: the one SQLite file and the photo tree (`photos/yyyy/mm/`, with Jasper's thumbnails beside the originals). A deploy can never reach it.

**The environment file.** Both units read their paths and the key from `/etc/quarry/quarry.env`:

- It is root-owned, mode 0600. systemd reads it before dropping to todd.
- It holds `QUARRY_DB`, `QUARRY_DATA` and `AI_GATEWAY_API_KEY`, and optionally the two model slugs and `MINDAT_API_KEY`.
- The keys are in that file and nowhere else. Jasper will not start without the gateway key; without the Mindat key it matches candidates by name only. The web unit never calls a model or Mindat.

**Which gateway key** is chosen at bring-up. The install script offers two:

- **The Conservatory's key:** one bill for the house's apps.
- **A key of the Quarry's own:** its spend shows apart in the gateway's dashboard.

The Aviary's and the Conservatory's units, Caddy blocks and watchers are never touched. The Quarry has its own files, its own watcher and its own port.

## Bring-up, and after a change to the units or the door

The first time, as todd:

```
git clone https://github.com/reclinerhead/quarry.git ~/quarry && sudo bash ~/quarry/Servers/install-orchid.sh
```

After that, `sudo bash ~/quarry/Servers/install-orchid.sh`. It is idempotent, and it ends by listing what is left. In order, it:

1. **Checks** node under nvm, pnpm on the login PATH, uv, and that port 3020 is free.
2. **Makes** the data directory, and the environment file from `Servers/quarry.env.example` if it is missing.
3. **Asks for the keys** when the file has none: the gateway key (the choice above), then the Mindat key, which Enter skips. A file from before Mindat gets an empty `MINDAT_API_KEY=` line added rather than a stop. Keys are written with shell builtins, so they are never echoed and never on a command line. Re-running the script is how a Mindat key reaches orchid.
4. **Builds** Jasper's venv.
5. **Creates or migrates the database** through `jasper.db`, so the web app has one before Jasper's first job.
6. **Builds the web app.**
7. **Installs and starts the units**, with the `node-path.conf` drop-in. Node lives under nvm, which systemd does not load, so the drop-in pins `PATH` to the versioned bin. Re-run the script after an nvm upgrade. Jasper starts only once the key is in the file.
8. **Opens the door,** as below.

**The door is the one step that reaches into another repo.** Orchid's Caddy config is the Aviary's:

- **Its copies.** `project-squirrel/Servers/Caddyfile-orchid` is the canonical copy, and `/etc/caddy/Caddyfile` is the live one.
- **The import.** The canonical copy needs this line at its end, beside the Conservatory's:

  ```
  import /home/todd/quarry/Servers/Caddyfile.quarry
  ```

  The line goes in by a PR there. The Aviary's watcher then pulls it onto orchid.
- **The sync.** On the next run, the install script sees the line in the Aviary's checkout but not in the live file. It shows the diff and asks before copying the whole file into place.
- **The reload.** It parses the new config with `caddy adapt` first and keeps a `.before-quarry` copy. Caddy itself refuses a reload it cannot load and keeps serving the old config.
- **Later changes.** After a later change to `Caddyfile.quarry`, the script reloads Caddy on its next run. It compares the file with the copy it last loaded, kept in `/etc/quarry/`.

## Deploys

Merging a PR is the deploy. `quarry-autodeploy` polls origin/main every 60 s over anonymous https. The repo is public, so there is no key on the box. When main moves, it pulls `--ff-only` and acts on what changed:

| Changed | It does |
| --- | --- |
| `jasper/` | Installs if `jasper/requirements.txt` changed (uv into the venv), then restarts `jasper`. A schema migration runs as Jasper starts, before the web app's new build serves. |
| `web/`, or `design/tokens.css` | `pnpm install` and `pnpm build`, then restarts `quarry-web` **only if the build passed**. A failed build is a loud journal line, and the old build keeps serving. `globals.css` imports the tokens, which is why they count. |
| `Servers/autodeploy.sh` | Hands over to the new copy. |
| A unit or `Caddyfile.quarry` | Logs that the next run of the install script applies it. |
| Anything else | Nothing (docs, tests, the spikes, the design brief). |

How it behaves:

- **Quiet ticks log nothing,** so `journalctl -u quarry-autodeploy` reads as a deploy history and silence is healthy.
- **A dirty checkout** (tracked changes) is skipped loudly until cleaned.
- **Checking out a branch** on the box pauses deploys, and checking out main resumes them.
- **By hand:** `Servers/deploy-web.sh` deploys the web app in the one valid order (pull, install, build, restart). `autodeploy.sh --once` is a single tick.

**Two things a merge never does:**

- **Change Caddy.** The install script applies a change to `Caddyfile.quarry`.
- **Change the environment file.** A variable added to the example reaches the box only by hand: add the line to `/etc/quarry/quarry.env` with `sudoedit`, then restart both units. They read the file only when they start.

## Checking it

`bash ~/quarry/Servers/check.sh` prints:

- the checkout and the build id;
- each unit's state;
- the answer on `:3020`;
- the answer at the door, checked through this box's Caddy without DNS, since orchid's standby Pi-hole is not kept in step with pearl's;
- pearl's record for `quarry.lan`, when `dig` is installed;
- the watcher's last lines, and Jasper's.

**Jasper's journal** has one line per job, with what each model said and what the job cost:

```
job 7 identified: haiku Galena 0.82 · flash Galena 0.90 · $0.0041 · 6.2 s
```

- A model that did not answer makes it a WARNING.
- A job that failed for good, such as a bad key, is an ERROR.
- A spent gateway budget pauses Jasper for ten minutes and says until when.
- On start it names both models and the prompt version.
- A photo costs about 0.4¢ for both models together: four came to 1.6¢ in #9's check. The gateway's dashboard has the bill.

**From a phone on the house Wi-Fi**, `https://quarry.lan` should show the collection. The first visit needs the house root certificate installed: the same one the Aviary's and the Conservatory's doors use.

## Backups

The database is a WAL file with a writer that holds it open, so `cp` gives you a stale copy with no error. `Servers/backup.sh` uses the sqlite backup API, which reads through the WAL:

- It writes `~/backups/quarry-<date>.db`.
- It prints a quick_check and the row counts.

The photos and their thumbnails are plain files: copy `quarry-data/photos/` beside the backup. Off the box, monthly, and before any migration step.

## Rolling back

- **A bad merge of code:** fix forward.
  - Revert the merge on main, and the watcher deploys the revert within a minute.
  - A web build that fails never restarts the unit, so a type error CI could not see leaves the previous build serving.
- **A unit that will not start:** `journalctl -u <unit> -n 50`. The usual causes:
  - **an empty or wrong key** (Jasper). It exits 2 and systemd does not retry, so fix the file and restart it;
  - **a node path that moved under nvm** (the web app). Re-run the install script;
  - **a missing environment file.**
- **Data:** restore the newest backup to `QUARRY_DB` with both units stopped (`sudo systemctl stop jasper quarry-web`), and expect to lose what was recorded since. A restore is for a lost or corrupt file, never for a change of mind.
- **The door:** `/etc/caddy/Caddyfile.before-quarry` is the live file from before the install script first synced it.
- **Everything off:** `sudo systemctl disable --now quarry-web jasper quarry-autodeploy`. The Aviary and the Conservatory do not notice.
