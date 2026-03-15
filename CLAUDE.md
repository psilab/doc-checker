# CLAUDE.md

## Project overview

Static site + GitHub Actions pipeline that checks NZ hut availability and sends Telegram notifications. Deployed to GitHub Pages.

## Key decisions

- **No Node locally** — user has no local Node.js. Never suggest running scripts locally. All execution happens in GitHub Actions.
- **No dependencies** — no package.json, no npm. Uses Node built-ins and native `fetch` (Node 24).
- **`data/` is committed** — `data/{id}.json` files are committed to the repo so GitHub Pages can serve them. `data.old/` is gitignored (temp, workflow-only).
- **`config.json` is source of truth** — hut list, IDs, names, and watched dates all live here. Both frontend and notify script read from it.
- **`API_BASE_URL` ends without facility ID** — e.g. `.../occupancygrid`. The facility ID is appended in `fetch.js` per hut.
- **Timezone fix** — calendar uses `localDate()` helper instead of `toISOString()` to avoid UTC date shift (user is in NZ, UTC+13).

## Notification logic

Telegram notification fires only when a watched date transitions from `IsAvailable: false` → `true` AND `TotalAvailable > 1`.

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
