# Hut Availability Checker

Tracks bed availability for NZ huts and sends Telegram notifications when watched dates open up.

## How it works

- GitHub Actions runs every hour, fetches availability data from the NZ recreation booking API and saves to `data/{id}.json`
- A static page (`index.html`) displays color-coded calendars for all huts
- `notify.js` compares old vs new data and sends a Telegram message if a watched date goes from full → available (with more than 1 space)

## Files

- `config.json` — list of huts with their IDs, names, and watched dates
- `fetch.js` — fetches availability data from the API for all huts
- `notify.js` — compares old/new data and sends Telegram notifications
- `index.html` — frontend calendar UI
- `data/{id}.json` — cached API responses, committed to repo

## Setup

**GitHub variables:**
- `API_BASE_URL` — `https://prod-nz-rdr.recreation-management.tylerapp.com/nzrdr/rdr/search/occupancygrid`
- `TELEGRAM_CHAT_ID` — your Telegram chat ID (get from `@userinfobot`)

**GitHub secrets:**
- `TELEGRAM_TOKEN` — bot token from `@BotFather`

**Local development:**
```
cp .env.example .env  # fill in API_BASE_URL
node --env-file=.env fetch.js
```

## Adding a hut

Add an entry to `config.json`:
```json
{ "id": 1234, "name": "Hut Name", "watchDates": [] }
```

## Calendar colors

- Green — plenty of space (≥10)
- Orange — few left (<10)
- Red — full or only 1 space
- Blue outline — watched date
