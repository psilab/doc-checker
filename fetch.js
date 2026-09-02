const fs = require("fs");

const { huts } = JSON.parse(fs.readFileSync("config.json", "utf8"));

const base = process.env.API_BASE_URL;
if (!base) throw new Error("API_BASE_URL is not set");

const today = new Date().toISOString().slice(0, 10);

// The API returns as many nights as asked for, but every night costs payload that gets
// committed to the repo. Fetch the usual window, and stretch it only for huts whose
// watched dates sit beyond it - otherwise notify.js silently never sees those dates.
const NIGHTS_MIN = 120;
const NIGHTS_MAX = 365;

function nightsFor(hut) {
    if (!hut.watchDates.length) return NIGHTS_MIN;

    const furthest = hut.watchDates.reduce((a, b) => (a > b ? a : b));
    const days = Math.round((Date.parse(furthest) - Date.parse(today)) / 86400000) + 1;

    if (days > NIGHTS_MAX) {
        console.warn(`[${hut.name}] Watched date ${furthest} is beyond ${NIGHTS_MAX} nights and will not be tracked`);
    }

    return Math.min(NIGHTS_MAX, Math.max(NIGHTS_MIN, days));
}

fs.mkdirSync("data", { recursive: true });

async function fetchHut(hut) {
    const nights = nightsFor(hut);
    const url = `${base}/${hut.id}/startdate/${today}/nights/${nights}/1`;

    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://prod-nz-rdr.recreation-management.tylerapp.com/",
            "Origin": "https://prod-nz-rdr.recreation-management.tylerapp.com",
            "X-Requested-With": "XMLHttpRequest"
        }
    });

    console.log(`[${hut.name}] Status:`, res.status, res.statusText);

    const text = await res.text();

    if (!res.ok) throw new Error(`[${hut.name}] API error: ${res.status} ${res.statusText}`);
    if (!text.trim()) throw new Error(`[${hut.name}] API returned empty response`);

    let data;
    try {
        data = JSON.parse(text);
    } catch (err) {
        console.error(`[${hut.name}] Response is not valid JSON:`, text);
        throw err;
    }

    delete data.Message;

    fs.writeFileSync(`data/${hut.id}.json`, JSON.stringify(data, null, 2) + "\n");
    console.log(`[${hut.name}] data/${hut.id}.json updated (${nights} nights)`);
}

async function run() {
    for (const hut of huts) {
        await fetchHut(hut);
    }
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
