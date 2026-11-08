# frontdoor: the Quarry's front door (issue #102)

`https://quarry.toddtech.llc/<station>` redirects to the Quarry on that
station, wherever the box lives on its home LAN right now:
`http://<its current address>/quarry`. The station keeps the record
current itself through the **Aviary's** front door (the `station-checkin`
timer posts to `aviary.toddtech.llc/api/checkin` every fifteen minutes and
on every new lease); this project reads the same Upstash database and
writes nothing. Design and reasoning: `docs/guide/ops.md` § The front door.
This README is the ops side: the Vercel project.

## What it serves

| Route | Answer |
| --- | --- |
| `GET /<station>[/path]` | `302` to `http://<last-known LAN ip>/quarry[/path]`, query string carried, `Cache-Control: no-store`. Unknown slug or never-reported station: a plain 404 page, no redirect |
| `GET /<station>/status` | last check-in time, address, interface, the Aviary's build sha on that box; the same record the Aviary's status page shows |
| `GET /` | a static landing page; lists nothing |

Route handlers only: no pages, no React tree. Pure logic in
`lib/frontdoor.ts`, covered by `lib/frontdoor.test.ts` (vitest; the CI
`frontdoor` job runs it, with `tsc --noEmit` and lint). The three pages are
HTML strings in `lib/pages.ts` in the Quarry's own language
(`design/DESIGN.md`), the fonts self-hosted from `public/fonts/`.

There is no check-in route, no roster and no token here. Enrolling a
station is nothing: a station that reports to the Aviary's door is on this
one.

## Vercel project (one-time)

This folder is its own Vercel project; nothing else in the repo deploys to
Vercel (the boxes pull from GitHub themselves, `docs/guide/ops.md`).

1. **Vercel → Add New → Project → Import `reclinerhead/quarry`.** The repo
   is public, but the Vercel GitHub app still needs access to it to deploy
   on push.
2. **Root Directory: `frontdoor`.** The Next.js preset is detected. Leave
   "Include source files outside the Root Directory" off.
3. **Skip builds for unrelated commits.** Project → Settings → Build and
   Deployment → Ignored Build Step: Behavior **Custom**, command

   ```
   git diff --quiet ${VERCEL_GIT_PREVIOUS_SHA:-HEAD^} HEAD -- .
   ```

   The trailing ` .` is the point: it limits the diff to this folder.
   Without it the command diffs the whole repository and never skips.
   Exit 0 means skip, so a merge touching only `web/`, `jasper/` or the
   docs deploys nothing. Diffing against the last deployed commit rather
   than `HEAD^` keeps a push of several commits from skipping a
   `frontdoor/` change that isn't the newest one; if that commit isn't in
   Vercel's clone, the diff errors and the build runs anyway. The step also
   runs on a **Redeploy** of an already-deployed commit, where the diff is
   empty, and cancels it; to ship a settings or storage change without a
   new commit, deploy from the CLI instead (Local, below).
4. **Storage: connect the Aviary's existing Upstash database.** Project →
   Storage → the Upstash for Redis database the Aviary's front door
   project already uses → Connect to this project (a Marketplace database
   connects to any number of projects). The integration injects
   `KV_REST_API_URL`, `KV_REST_API_TOKEN` and `KV_REST_API_READ_ONLY_TOKEN`.
   The code prefers the read-only token when it is present
   (`lib/store.ts`), so this project's env cannot write even by mistake;
   without it, `Redis.fromEnv()` reads the ordinary pair, or the
   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` pair pasted by
   hand from the Upstash console. Do not create a second database: the
   records this door reads are the ones the Aviary's door writes.

   A function gets its environment when it is built, and the import in
   step 1 builds at once, before the database is connected, so that first
   deployment answers 503 "store unavailable" on every station route.
   After connecting the database, deploy again (step 6).
5. **Domain `quarry.toddtech.llc`:** Project → Settings → Domains → Add.
   `toddtech.llc` is registered at Vercel on Vercel's nameservers, so
   adding the domain creates the DNS record itself and there is nothing to
   add at a DNS host. (A domain hosted elsewhere would need the CNAME
   Vercel prints.) The name resolves within a minute.
6. **Deploy again, now that the store is connected.** From a checkout
   linked to the project (`vercel link`, once, from the repo root; the
   Root Directory setting applies), `vercel deploy --prod`. Not Redeploy
   in the dashboard: step 3 cancels it. Then `https://quarry.toddtech.llc/`
   shows the landing page, `/nothing` the "not a station" page, and
   `/kestrel` answers:

   ```
   curl -si https://quarry.toddtech.llc/kestrel | head -5
   ```

   `302`, `location: http://<kestrel's current ip>/quarry`,
   `cache-control: no-store`. `/kestrel/status` shows the record.

**Then set the bookmarks.** The bookmark rule (`docs/guide/ops.md`): home-screen
icons and bookmarks at a station point at `https://quarry.toddtech.llc/<station>`,
never at the IP, and Todd sets them. A person who bookmarks after landing
has bookmarked the IP again. The link only works from that house's Wi-Fi
and lands on plain HTTP on the LAN, like the Aviary's.

## Local

```
pnpm install
pnpm test
pnpm exec tsc --noEmit
pnpm lint
pnpm dev          # KV_REST_API_URL + KV_REST_API_READ_ONLY_TOKEN in .env.local to read the store
```

The Vercel CLI is the Linux one under nvm (`npm install -g vercel`), not
the Windows copy WSL finds on `/mnt/c`. `vercel link` from the repo root
writes a gitignored `.vercel/`; `vercel deploy --prod` from there ships
the working tree (not a commit) as a production deployment, which is how
a settings change reaches production without a push.

Without the store variables every station route answers 503 "store
unavailable"; the landing page and the validators need nothing.
