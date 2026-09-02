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

// DOC ids and Auckland Council ids are separate number spaces, so AKL files carry a prefix
// to keep them from ever colliding. Same helper lives in notify.js and index.html.
function dataKey(hut) {
    return hut.source === "akl" ? `akl-${hut.id}` : String(hut.id);
}

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

async function fetchDocHut(hut) {
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

    fs.writeFileSync(`data/${dataKey(hut)}.json`, JSON.stringify(data, null, 2) + "\n");
    console.log(`[${hut.name}] data/${dataKey(hut)}.json updated (${nights} nights)`);
}

// --- Auckland Council regional parks -------------------------------------------------
//
// Second source alongside DOC. Its availability API is public but sits behind a bearer
// token, and it answers a date span at a time (it rejects anything past roughly two
// months), so a run is: scrape one token, then one call per month per property.
// See NOTES.md for how the endpoint and its date format were worked out.

const AKL_PAGE_BASE = "https://www.aucklandcouncil.govt.nz/en/parks-recreation/stay-at-park/find-accommodation/accommodation-details";
const AKL_API = "https://experience.aucklandcouncil.govt.nz/nextapi/accommodations";

// "Bookings can only be made six months in advance for campgrounds." The API still answers
// past that, but with raw capacity rather than anything bookable, so this is the horizon.
// A watched date further out stretches the window, up to a cap - every extra month is
// another request against a host that asks not to be scraped heavily.
const AKL_MONTHS_MIN = 6;
const AKL_MONTHS_MAX = 12;

// aucklandcouncil.govt.nz sits behind a bot filter that answers a plain request with 406.
// No single header gets through - it wants the full shape of a Chrome navigation.
const AKL_PAGE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "en-NZ,en;q=0.9",
    "sec-ch-ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1"
};

const AKL_API_HEADERS = {
    "User-Agent": AKL_PAGE_HEADERS["User-Agent"],
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-NZ,en;q=0.9",
    "Origin": "https://www.aucklandcouncil.govt.nz",
    "Referer": "https://www.aucklandcouncil.govt.nz/"
};

// The closing quote matters: without it a chunk boundary can hand back a truncated token.
const AKL_TOKEN_RE = /initialToken\\?":\\?"(eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+)\\?"/;

const pad = n => String(n).padStart(2, "0");

// Their API wants a local wall-clock stamp with no zone. Copied from the site's own
// formatter, down to the 01:00 on the first day - which dodges the DST-transition hour.
function aklStamp(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function localDate(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function aklMonthsFor(hut) {
    if (!hut.watchDates.length) return AKL_MONTHS_MIN;

    const furthest = hut.watchDates.reduce((a, b) => (a > b ? a : b));
    const [year, month] = furthest.split("-").map(Number);
    const now = new Date();
    const span = (year - now.getFullYear()) * 12 + (month - 1 - now.getMonth()) + 1;

    if (span > AKL_MONTHS_MAX) {
        console.warn(`[${hut.name}] Watched date ${furthest} is beyond ${AKL_MONTHS_MAX} months and will not be tracked`);
    } else if (span > AKL_MONTHS_MIN) {
        console.warn(`[${hut.name}] Watched date ${furthest} is past the six-month booking window - capacity there is not real availability yet`);
    }

    return Math.min(AKL_MONTHS_MAX, Math.max(AKL_MONTHS_MIN, span));
}

// The token only ships inside the Next.js app on an accommodation-details page, and it sits
// in the first ~65 KB of a 5.5 MB document. Read until it turns up, then drop the rest.
async function fetchAklToken(hut) {
    const res = await fetch(`${AKL_PAGE_BASE}/${hut.id}.html`, { headers: AKL_PAGE_HEADERS });

    if (!res.ok) throw new Error(`[${hut.name}] Token page error: ${res.status} ${res.statusText}`);

    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });

        const match = buffer.match(AKL_TOKEN_RE);
        if (match) return match[1];

        // A token plus its surrounding markup never spans more than this.
        buffer = buffer.slice(-500);
    }

    throw new Error(`[${hut.name}] No session token found on the accommodation page`);
}

async function fetchAklMonth(hut, token, first, last) {
    const url = `${AKL_API}?reqType=availability&productId=${hut.productId}` +
        `&firstDay=${aklStamp(first)}&lastDay=${aklStamp(last)}`;

    const res = await fetch(url, { headers: { ...AKL_API_HEADERS, "Authorization": `Bearer ${token}` } });

    if (!res.ok) throw new Error(`[${hut.name}] API error: ${res.status} ${res.statusText}`);

    const text = await res.text();

    let data;
    try {
        data = JSON.parse(text);
    } catch (err) {
        console.error(`[${hut.name}] Response is not valid JSON:`, text);
        throw err;
    }

    // Errors come back as 200 with an error object in the body, so the shape is the check.
    if (!Array.isArray(data)) throw new Error(`[${hut.name}] API returned ${text}`);

    return data;
}

async function fetchAklHut(hut, token) {
    const months = aklMonthsFor(hut);
    const now = new Date();
    const from = localDate(now);
    const days = [];

    for (let i = 0; i < months; i++) {
        const first = new Date(now.getFullYear(), now.getMonth() + i, 1, 1, 0, 0);
        const last = new Date(now.getFullYear(), now.getMonth() + i + 1, 0, 23, 59, 59);
        const entries = await fetchAklMonth(hut, token, first, last);

        for (const entry of entries) {
            // Months are calendar-aligned, so the first one reaches back before today.
            const date = entry.date.slice(0, 10);
            if (date >= from) days.push({ date, capacity: entry.capacity });
        }
    }

    if (!days.length) throw new Error(`[${hut.name}] API returned no days`);

    // Auckland Council never states a property's size, so take the emptiest day in view as
    // its capacity. Only the calendar's green/orange shading depends on it.
    const maxCapacity = days.reduce((max, d) => Math.max(max, d.capacity), 0);

    const data = { productId: hut.productId, maxCapacity, days };

    fs.writeFileSync(`data/${dataKey(hut)}.json`, JSON.stringify(data, null, 2) + "\n");
    console.log(`[${hut.name}] data/${dataKey(hut)}.json updated (${days.length} days over ${months} months, capacity ${maxCapacity})`);
}

async function run() {
    let aklToken = null;

    for (const hut of huts) {
        if (hut.source === "akl") {
            // The token lasts about fifteen minutes and is not tied to a property, so one
            // scrape covers the whole run however many Auckland Council entries are listed.
            aklToken ??= await fetchAklToken(hut);
            await fetchAklHut(hut, aklToken);
        } else {
            await fetchDocHut(hut);
        }
    }
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
