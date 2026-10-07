# CLAUDE.md

## Project overview

Static site + GitHub Actions pipeline that checks NZ hut and campground availability and sends Telegram notifications. Deployed to GitHub Pages.

## Key decisions

- **No Node locally** — user has no local Node.js. Never suggest running scripts locally. All execution happens in GitHub Actions.
- **No dependencies** — no package.json, no npm. Uses Node built-ins and native `fetch` (Node 24).
- **`data/` is committed** — `data/{key}.json` files are committed to the repo so GitHub Pages can serve them. `data.old/` is gitignored (temp, workflow-only).
- **`config.json` is source of truth** — every entry carries a `source` (`"doc"`, `"akl"` or `"newbook"`), its ids, name and watched dates. Both frontend and notify script read from it.
- **Three sources, one internal shape** — `daysOf()` flattens every API to `{ date, free }` per night. It is duplicated in `notify.js` and `index.html` (no build step, no module sharing), as are `dataKey()` and `minFree()`. Keep the copies in step.
- **`API_BASE_URL` ends without facility ID** — e.g. `.../occupancygrid`. The facility ID is appended in `fetch.js` per hut. Auckland Council's and Newbook's hosts are hardcoded instead: they are public and already documented in the repo.
- **Timezone fix** — calendar uses `localDate()` helper instead of `toISOString()` to avoid UTC date shift (user is in NZ, UTC+13).
- **Commit and push freely** — user has given standing approval to commit and push in this repo, directly on `main`, without asking each time.

## Notification logic

Two rules, both firing only on a transition between runs, and both using `minFree()` as the bar for "free": 2 for DOC huts and Auckland Council campgrounds, 1 for whole-unit types (`Bach`, `Tiny home`, `Lodge`, `Glamping`, `Tent`) where any free space means the whole place came free, and 1 for Newbook, which only reports whether any site is free, never how many. A hut can override it with its own `minFree` in `config.json` (Crosbies Hut uses 4 for a bigger party).

- `watchDates` — a listed night goes from below `minFree()` to at least `minFree()`.
- `watchStays` — `{ nights, from, to }`. A run of `nights` consecutive free nights, wholly inside `from`..`to`, that was not bookable last run and is now. Both runs must cover the whole span, so a window that has just grown reports nothing: those nights came into view, they did not open up.

## GitHub Actions secrets/vars

- `vars.API_BASE_URL` — base API URL without facility ID
- `vars.TELEGRAM_CHAT_ID` — not sensitive, stored as var
- `secrets.TELEGRAM_TOKEN` — bot token, stored as secret

## Workflow flow

Runs every quarter hour: on the hour for every source, at :15, :30 and :45 for DOC and Newbook only (the workflow passes `SOURCES` to `fetch.js`, keyed on which cron fired). GitHub's own scheduler skips most of these, so two cron-job.org jobs drive the real cadence by calling `workflow_dispatch` with a `sources` input (`doc,newbook` at :15/:30/:45, empty on the hour), using a fine-grained token of the user's that only has Actions write on this repo. The `schedule:` entries stay as a fallback. Runs queue rather than cancel each other, and check out `main` rather than the triggering commit.

1. Copy `data/*.json` → `data.old/`
2. Run `fetch.js` → updates `data/*.json`. Each hut is fetched independently: a failed one keeps its previous file and logs a `::warning::` annotation, never a failed run (a failed run emails the user, and a source down for a day is routine). Every file carries `fetchedAt`, and AKL files a `stale` map of months carried over from an earlier run; the page shows a small "slightly out of date" note from those
3. Run `notify.js` → compares old vs new, sends Telegram if needed
4. Commit `data/` if changed
5. Deploy to GitHub Pages
