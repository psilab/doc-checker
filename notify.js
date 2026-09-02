const fs = require("fs");

const { huts } = JSON.parse(fs.readFileSync("config.json", "utf8"));

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !chatId) throw new Error("TELEGRAM_TOKEN or TELEGRAM_CHAT_ID is not set");

const DAY = 86400000;

// Auckland Council's own calendar renders these types as two-state, because they are booked
// whole: their capacity is either zero or the entire place. Tāwharanui Bach, for instance,
// only ever reports 0 or 6 - never a partial count the way a campground or a hut does.
const WHOLE_UNIT_TYPES = ["Bach", "Tiny home", "Lodge", "Glamping", "Tent"];

// DOC ids and Auckland Council ids are separate number spaces, so AKL files carry a prefix
// to keep them from ever colliding. Same helper lives in fetch.js and index.html.
function dataKey(hut) {
    return hut.source === "akl" ? `akl-${hut.id}` : String(hut.id);
}

// The two sources store different shapes, so flatten both to { date, free } per night and
// let everything downstream stay source-agnostic. Same helper lives in index.html.
function daysOf(hut, json) {
    if (hut.source === "akl") {
        // Overbooked or closed days come back as a negative capacity. Nothing downstream
        // wants to reason about that, so it is just as unavailable as zero.
        return (json?.days ?? []).map(d => ({ date: d.date, free: Math.max(0, d.capacity) }));
    }

    return Object.values(json?.Facility?.Dates ?? {})
        .map(d => ({ date: d.Date, free: d.IsAvailable ? d.TotalAvailable : 0 }));
}

// A single leftover bed in a hut or on a campsite is no use to a party, so those have to
// open up at least two. For a whole-unit type any free space at all means the entire place
// came free, so one is enough - and that holds even for a unit that only sleeps one.
function minFree(hut) {
    return hut.source === "akl" && WHOLE_UNIT_TYPES.includes(hut.type) ? 1 : 2;
}

function addDays(date, n) {
    return new Date(Date.parse(date) + n * DAY).toISOString().slice(0, 10);
}

function plural(n, word) {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

async function sendMessage(text) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text })
    });
    const r = await res.json();
    if (!r.ok) throw new Error(JSON.stringify(r));
    console.log("Telegram notification sent");
}

// --- watchDates: a specific night going from full to bookable ------------------------

function freedDates(hut, oldFree, newFree, threshold) {
    const watched = hut.watchDates ?? [];

    const missing = watched.filter(date => !(date in newFree));
    if (missing.length) {
        console.warn(`[${hut.name}] Watched dates missing from fetched data: ${missing.join(", ")}`);
    }

    return watched
        .filter(date => date in oldFree && date in newFree)
        .filter(date => oldFree[date] === 0 && newFree[date] >= threshold)
        .map(date => `📅 ${date} — ${plural(newFree[date], "place")} available`);
}

// --- watchStays: a run of consecutive nights anywhere inside a range ------------------
//
// "Any three nights together in January" is not a list of dates, so it cannot be expressed
// as watchDates. A stay is bookable when every one of its nights clears the threshold, and
// what gets reported is a start date that was not bookable last run and is now.

function openedStarts(stay, oldFree, newFree, threshold) {
    const opened = [];

    for (let date = stay.from; addDays(date, stay.nights - 1) <= stay.to; date = addDays(date, 1)) {
        const nights = Array.from({ length: stay.nights }, (_, i) => addDays(date, i));

        // A night missing from either run is unknowable rather than free, and both sides
        // have to be checked: a stretch the previous run never looked at - because the
        // window has since grown - has not opened up, it has only come into view.
        if (!nights.every(night => night in oldFree && night in newFree)) continue;

        const was = nights.every(night => oldFree[night] >= threshold);
        const is = nights.every(night => newFree[night] >= threshold);

        if (!was && is) opened.push(date);
    }

    return opened;
}

function groupConsecutive(dates) {
    return dates.reduce((groups, date) => {
        const last = groups.at(-1);
        if (last && addDays(last.at(-1), 1) === date) last.push(date);
        else groups.push([date]);
        return groups;
    }, []);
}

function freedStays(hut, oldFree, newFree, threshold) {
    const lines = [];

    for (const stay of hut.watchStays ?? []) {
        const uncovered = [];
        for (let date = stay.from; date <= stay.to; date = addDays(date, 1)) {
            if (!(date in newFree)) uncovered.push(date);
        }
        if (uncovered.length) {
            console.warn(`[${hut.name}] ${stay.from}..${stay.to} is only partly in the fetched data - ${plural(uncovered.length, "night")} missing`);
        }

        const opened = openedStarts(stay, oldFree, newFree, threshold);
        if (!opened.length) continue;

        // Overlapping start dates all describe one stretch of free nights, so report the
        // stretch rather than one line per start.
        for (const group of groupConsecutive(opened)) {
            const first = group[0];
            const last = addDays(group.at(-1), stay.nights - 1);
            const nights = group.length + stay.nights - 1;

            let smallest = Infinity;
            for (let date = first; date <= last; date = addDays(date, 1)) {
                smallest = Math.min(smallest, newFree[date]);
            }

            lines.push(`🏕 ${first} – ${last} — ${plural(nights, "night")} together, at least ${plural(smallest, "place")} free`);
        }
    }

    return lines;
}

async function checkHut(hut) {
    const oldPath = `data.old/${dataKey(hut)}.json`;
    const newPath = `data/${dataKey(hut)}.json`;

    if (!(hut.watchDates ?? []).length && !(hut.watchStays ?? []).length) return;
    if (!fs.existsSync(oldPath)) return;

    const oldDays = daysOf(hut, JSON.parse(fs.readFileSync(oldPath, "utf8")));
    const newDays = daysOf(hut, JSON.parse(fs.readFileSync(newPath, "utf8")));

    if (!oldDays.length || !newDays.length) return;

    const byDate = days => Object.fromEntries(days.map(d => [d.date, d.free]));
    const oldFree = byDate(oldDays);
    const newFree = byDate(newDays);
    const threshold = minFree(hut);

    const lines = [
        ...freedDates(hut, oldFree, newFree, threshold),
        ...freedStays(hut, oldFree, newFree, threshold)
    ];

    if (!lines.length) {
        console.log(`[${hut.name}] No changes for watched dates`);
        return;
    }

    await sendMessage(`🟢 ${hut.name} spots opened up!\n\n${lines.join("\n")}`);
}

async function run() {
    for (const hut of huts) {
        await checkHut(hut);
    }
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
