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

// DOC, Auckland Council and every Newbook property number their ids separately, so the
// non-DOC files carry a prefix to keep them from ever colliding. Same helper lives in
// notify.js and index.html.
function dataKey(hut) {
    if (hut.source === "akl") return `akl-${hut.id}`;
    if (hut.source === "newbook") return `newbook-${hut.property}-${hut.id}`;
    return String(hut.id);
}

// The window has to reach whatever is being watched, whether that is a single night or the
// far end of a range that a run of consecutive nights is hunted in.
function furthestWatched(hut) {
    const dates = [...(hut.watchDates ?? []), ...(hut.watchStays ?? []).map(s => s.to)];
    return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
}

function nightsFor(hut) {
    const furthest = furthestWatched(hut);
    if (!furthest) return NIGHTS_MIN;

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

// Both hosts sit behind gateways that give up on a slow backend, and since October 2026
// roughly every other request runs past that. Which ones is random - the same month
// fails, then succeeds on the next try - so a 5xx is retried rather than fatal.
const AKL_ATTEMPTS = 6;
const AKL_RETRY_PAUSE_MS = 5000;

async function aklFetch(hut, url, headers) {
    for (let attempt = 1; ; attempt++) {
        const res = await fetch(url, { headers });
        if (res.status < 500 || attempt === AKL_ATTEMPTS) return res;

        await res.text();
        console.warn(`[${hut.name}] ${res.status} ${res.statusText}, retrying (${attempt}/${AKL_ATTEMPTS - 1})`);
        await new Promise(resolve => setTimeout(resolve, AKL_RETRY_PAUSE_MS));
    }
}

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
    const furthest = furthestWatched(hut);
    if (!furthest) return AKL_MONTHS_MIN;

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
    const res = await aklFetch(hut, `${AKL_PAGE_BASE}/${hut.id}.html`, AKL_PAGE_HEADERS);

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

    const res = await aklFetch(hut, url, { ...AKL_API_HEADERS, "Authorization": `Bearer ${token}` });

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
    const path = `data/${dataKey(hut)}.json`;
    const days = [];
    const failed = [];

    for (let i = 0; i < months; i++) {
        const first = new Date(now.getFullYear(), now.getMonth() + i, 1, 1, 0, 0);
        const last = new Date(now.getFullYear(), now.getMonth() + i + 1, 0, 23, 59, 59);

        let entries;
        try {
            entries = await fetchAklMonth(hut, token, first, last);
        } catch (err) {
            console.error(err.message);
            failed.push(localDate(first).slice(0, 7));
            continue;
        }

        for (const entry of entries) {
            // Months are calendar-aligned, so the first one reaches back before today.
            const date = entry.date.slice(0, 10);
            if (date >= from) days.push({ date, capacity: entry.capacity });
        }
    }

    // Even six attempts sometimes all hit the gateway timeout. One lost month should not
    // throw away the rest, so it keeps the previous run's nights: unchanged values cannot
    // set off a notification, and the run still goes red below.
    if (failed.length && fs.existsSync(path)) {
        const previous = JSON.parse(fs.readFileSync(path, "utf8")).days ?? [];
        days.push(...previous.filter(d => d.date >= from && failed.includes(d.date.slice(0, 7))));
        days.sort((a, b) => a.date.localeCompare(b.date));
    }

    if (!days.length) throw new Error(`[${hut.name}] API returned no days`);

    // Auckland Council never states a property's size, so take the emptiest day in view as
    // its capacity. Only the calendar's green/orange shading depends on it.
    const maxCapacity = days.reduce((max, d) => Math.max(max, d.capacity), 0);

    const data = { productId: hut.productId, maxCapacity, days };

    fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
    console.log(`[${hut.name}] ${path} updated (${days.length} days over ${months} months, capacity ${maxCapacity})`);

    if (failed.length) throw new Error(`[${hut.name}] ${failed.join(", ")} kept from the previous run`);
}

// --- Newbook (Camp Waipu Cove) ---------------------------------------------------------
//
// Third source: a private holiday park on Newbook's hosted booking engine. Its calendar
// endpoint needs no cookie, token or form fields - only the API address, which carries a
// hash and so is read off the booking page each run rather than hardcoded. It reports
// per night whether any site of a category is free, never how many. See NOTES.md.

const NEWBOOK_BASE = "https://bookingsap.newbook.cloud/online";

// One request answers any span, so the usual window is a year and it only grows to reach
// a watched date further out.
const NEWBOOK_MONTHS_MIN = 12;

const NEWBOOK_API_RE = /newbook_api_path='([^']+)'/;

// Cloudflare sits in front of Newbook. From NZ it passes anything, even curl's default
// User-Agent, but some GitHub runner IPs get a 403 - so look like a browser, and say why
// when it still refuses.
const NEWBOOK_HEADERS = {
    "User-Agent": AKL_PAGE_HEADERS["User-Agent"],
    "Accept-Language": "en-NZ,en;q=0.9"
};

function newbookError(hut, what, res) {
    const mitigated = res.headers.get("cf-mitigated");
    return new Error(`[${hut.name}] ${what}: ${res.status} ${res.statusText}${mitigated ? ` (cf-mitigated: ${mitigated})` : ""}`);
}
const NEWBOOK_DAY_RE = /<td class="day ([^"]+)" data-date="(\d{4}-\d{2}-\d{2})"/g;

function newbookMonthsFor(hut) {
    const furthest = furthestWatched(hut);
    if (!furthest) return NEWBOOK_MONTHS_MIN;

    const [year, month] = furthest.split("-").map(Number);
    const now = new Date();
    return Math.max(NEWBOOK_MONTHS_MIN, (year - now.getFullYear()) * 12 + (month - 1 - now.getMonth()) + 1);
}

// The page is only read for the API address, so when it is refused the address the last
// run found is just as good - the API call may well get through where the page did not.
async function newbookApi(hut, path) {
    const page = await fetch(`${NEWBOOK_BASE}/${hut.property}`, { headers: { ...NEWBOOK_HEADERS, "Accept": "text/html" } });
    const api = page.ok ? (await page.text()).match(NEWBOOK_API_RE)?.[1] : null;
    if (api) return api;

    const previous = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")).api : null;
    const why = page.ok ? `[${hut.name}] No API address found on the booking page` : newbookError(hut, "Booking page error", page).message;

    if (!previous) throw new Error(why);
    console.warn(`${why} - using the API address from the previous run`);
    return previous;
}

async function fetchNewbookCategory(hut) {
    const path = `data/${dataKey(hut)}.json`;
    const api = await newbookApi(hut, path);

    const months = newbookMonthsFor(hut);
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + months - 1, 1);
    const month = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

    const res = await fetch(`${api}newbook_api_action=data`, {
        method: "POST",
        headers: { ...NEWBOOK_HEADERS, "Accept": "application/json" },
        body: new URLSearchParams({
            query: "newbook_calendar_update_table_dates",
            category_id: hut.id,
            look_up_date: month(now),
            period_from: month(now),
            period_to: month(last)
        })
    });

    if (!res.ok) throw newbookError(hut, "API error", res);

    const text = await res.text();
    const rows = JSON.parse(text)?.calendar_data?.table_rows;
    if (typeof rows !== "string") throw new Error(`[${hut.name}] API returned ${text.slice(0, 300)}`);

    // Each night is a cell whose first class is its state - "available" or "booked" - and
    // whose others, like closed_arrival, are booking rules rather than availability.
    const days = [...rows.matchAll(NEWBOOK_DAY_RE)]
        .map(([, classes, date]) => ({ date, available: classes.split(" ")[0] === "available" }))
        .filter(d => d.date >= today);

    if (!days.length) throw new Error(`[${hut.name}] API returned no days`);

    const data = { property: hut.property, categoryId: hut.id, api, days };

    fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
    console.log(`[${hut.name}] ${path} updated (${days.length} days over ${months} months)`);
}

// One host timing out must not cost every other hut its update. A failed hut keeps
// yesterday's file, so notify.js sees no change for it; the exit code still goes red
// so the run shows the failure, and the workflow commits and deploys regardless.
async function run() {
    let aklToken = null;

    for (const hut of huts) {
        try {
            if (hut.source === "akl") {
                // The token lasts about fifteen minutes and is not tied to a property, so one
                // scrape covers the whole run however many Auckland Council entries are listed.
                aklToken ??= await fetchAklToken(hut);
                await fetchAklHut(hut, aklToken);
            } else if (hut.source === "newbook") {
                await fetchNewbookCategory(hut);
            } else {
                await fetchDocHut(hut);
            }
        } catch (err) {
            console.error(err);
            process.exitCode = 1;
        }
    }
}

run();
