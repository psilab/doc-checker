const fs = require("fs");

const { huts } = JSON.parse(fs.readFileSync("config.json", "utf8"));

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !chatId) throw new Error("TELEGRAM_TOKEN or TELEGRAM_CHAT_ID is not set");

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

async function checkHut(hut) {
    const oldPath = `data.old/${dataKey(hut)}.json`;
    const newPath = `data/${dataKey(hut)}.json`;

    if (!hut.watchDates.length) return;
    if (!fs.existsSync(oldPath)) return;

    const oldDays = daysOf(hut, JSON.parse(fs.readFileSync(oldPath, "utf8")));
    const newDays = daysOf(hut, JSON.parse(fs.readFileSync(newPath, "utf8")));

    if (!oldDays.length || !newDays.length) return;

    const missing = hut.watchDates.filter(date => !newDays.some(d => d.date === date));
    if (missing.length) {
        console.warn(`[${hut.name}] Watched dates missing from fetched data: ${missing.join(", ")}`);
    }

    const threshold = minFree(hut);

    const freed = hut.watchDates.filter(date => {
        const oldEntry = oldDays.find(d => d.date === date);
        const newEntry = newDays.find(d => d.date === date);
        return oldEntry && newEntry && oldEntry.free === 0 && newEntry.free >= threshold;
    });

    if (!freed.length) {
        console.log(`[${hut.name}] No changes for watched dates`);
        return;
    }

    const lines = freed.map(date => {
        const free = newDays.find(d => d.date === date).free;
        return `📅 ${date} — ${free} place${free === 1 ? "" : "s"} available`;
    });

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
