# CLAUDE.md

## Project overview

Static site + GitHub Actions pipeline that checks NZ hut and campground availability and sends Telegram notifications. Deployed to GitHub Pages.

## Key decisions

- **No Node locally** — user has no local Node.js. Never suggest running scripts locally. All execution happens in GitHub Actions.
- **No dependencies** — no package.json, no npm. Uses Node built-ins and native `fetch` (Node 24).
- **`data/` is committed** — `data/{key}.json` files are committed to the repo so GitHub Pages can serve them. `data.old/` is gitignored (temp, workflow-only).
- **`config.json` is source of truth** — every entry carries a `source` (`"doc"` or `"akl"`), its ids, name and watched dates. Both frontend and notify script read from it.
- **Two sources, one internal shape** — `daysOf()` flattens both APIs to `{ date, free }` per night. It is duplicated in `notify.js` and `index.html` (no build step, no module sharing), as are `dataKey()` and `minFree()`. Keep the copies in step.
- **`API_BASE_URL` ends without facility ID** — e.g. `.../occupancygrid`. The facility ID is appended in `fetch.js` per hut. Auckland Council's hosts are hardcoded instead: they are public and already documented in the repo.
- **Timezone fix** — calendar uses `localDate()` helper instead of `toISOString()` to avoid UTC date shift (user is in NZ, UTC+13).
- **Commit and push freely** — user has given standing approval to commit and push in this repo, directly on `main`, without asking each time.

## Notification logic

Two rules, both firing only on a transition between runs, and both using `minFree()` as the bar for "free": 2 for DOC huts and Auckland Council campgrounds, 1 for whole-unit types (`Bach`, `Tiny home`, `Lodge`, `Glamping`, `Tent`) where any free space means the whole place came free.

- `watchDates` — a listed night goes from 0 free spaces to at least `minFree()`.
- `watchStays` — `{ nights, from, to }`. A run of `nights` consecutive free nights, wholly inside `from`..`to`, that was not bookable last run and is now. Both runs must cover the whole span, so a window that has just grown reports nothing: those nights came into view, they did not open up.

## GitHub Actions secrets/vars

- `vars.API_BASE_URL` — base API URL without facility ID
- `vars.TELEGRAM_CHAT_ID` — not sensitive, stored as var
- `secrets.TELEGRAM_TOKEN` — bot token, stored as secret

## Workflow flow

1. Copy `data/*.json` → `data.old/`
2. Run `fetch.js` → updates `data/*.json`
3. Run `notify.js` → compares old vs new, sends Telegram if needed
4. Commit `data/` if changed
5. Deploy to GitHub Pages
