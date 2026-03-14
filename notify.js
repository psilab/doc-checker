const fs = require("fs");

const { huts } = JSON.parse(fs.readFileSync("config.json", "utf8"));

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !chatId) throw new Error("TELEGRAM_TOKEN or TELEGRAM_CHAT_ID is not set");

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
    const oldPath = `data.old/${hut.id}.json`;
    const newPath = `data/${hut.id}.json`;

    if (!fs.existsSync(oldPath) || !hut.watchDates.length) return;

    const oldDates = JSON.parse(fs.readFileSync(oldPath, "utf8")).Facility.Dates;
    const newDates = JSON.parse(fs.readFileSync(newPath, "utf8")).Facility.Dates;

    const freed = hut.watchDates.filter(date => {
        const oldEntry = Object.values(oldDates).find(d => d.Date === date);
        const newEntry = Object.values(newDates).find(d => d.Date === date);
        return oldEntry && newEntry && !oldEntry.IsAvailable && newEntry.IsAvailable;
    });

    if (!freed.length) {
        console.log(`[${hut.name}] No changes for watched dates`);
        return;
    }

    const lines = freed.map(date => {
        const d = Object.values(newDates).find(e => e.Date === date);
        return `📅 ${date} — ${d.TotalAvailable} places available`;
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
