# Hut Availability Checker

Tracks bed availability for NZ huts and campgrounds and sends Telegram notifications when
watched dates open up.

**Live site:** https://psilab.github.io/doc-checker/

## Sources

- **`doc`** — DOC huts, via the NZ recreation booking API (Tyler "Recreation Dynamics").
- **`akl`** — Auckland Council regional park accommodation: campgrounds, baches, lodges and
  glamping. Public API behind a short-lived bearer token that `fetch.js` scrapes per run.

Both are normalised to `{ date, free }` per night on read, so `notify.js` and the calendar
do not care which one produced a file. See `NOTES.md` for how each API works.

## How it works

- GitHub Actions runs once a day, fetches availability for every entry in `config.json` and
  saves it to `data/{key}.json`
- A static page (`index.html`) displays color-coded calendars
- `notify.js` compares old vs new data and sends a Telegram message if a watched date goes
  from full → available

## Files

- `config.json` — every hut and property, with its source, ids, name and watched dates
- `fetch.js` — fetches availability for all of them
- `notify.js` — compares old/new data and sends Telegram notifications
- `index.html` — frontend calendar UI
- `data/{key}.json` — cached responses, committed to repo. `{key}` is the bare id for DOC
  and `akl-{id}` for Auckland Council, since the two use separate id spaces.

## Setup

**GitHub variables:**
- `API_BASE_URL` — `https://prod-nz-rdr.recreation-management.tylerapp.com/nzrdr/rdr/search/occupancygrid`
- `TELEGRAM_CHAT_ID` — your Telegram chat ID (get from `@userinfobot`)

**GitHub secrets:**
- `TELEGRAM_TOKEN` — bot token from `@BotFather`

Auckland Council needs no configuration — its hosts are public and hardcoded in `fetch.js`.

**Local development:**
```
cp .env.example .env  # fill in API_BASE_URL
node --env-file=.env fetch.js
```

## Adding a hut

A DOC hut, where `id` is the facility id:
```json
{ "source": "doc", "id": 1234, "name": "Hut Name", "watchDates": [] }
```

An Auckland Council property, where `id` is the number in its accommodation-details URL and
`productId` and `type` come from that page's HTML, next to `accommodationAsCF`:
```json
{ "source": "akl", "id": 79, "productId": 220233, "type": "Camping", "name": "Name", "watchDates": [] }
```

`type` decides how many free spaces count as an opening: `Bach`, `Tiny home`, `Lodge`,
`Glamping` and `Tent` are booked whole, so any free space means the entire place came free.
Everything else is per-person, where a single leftover bed is no use to a party.

## Calendar colors

- Green — plenty of space
- Orange — few left (under a third of capacity)
- Red — full, or only 1 space where that is not a whole booking
- Blue outline — watched date
