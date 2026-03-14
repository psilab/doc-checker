const fs = require("fs");

const { watchDates } = JSON.parse(fs.readFileSync("config.json", "utf8"));

const oldData = JSON.parse(fs.readFileSync("data.old.json", "utf8"));
const newData = JSON.parse(fs.readFileSync("data.json", "utf8"));

const oldDates = oldData.Facility.Dates;
const newDates = newData.Facility.Dates;

const freed = watchDates.filter(date => {
    const oldEntry = Object.values(oldDates).find(d => d.Date === date);
    const newEntry = Object.values(newDates).find(d => d.Date === date);
    return oldEntry && newEntry && !oldEntry.IsAvailable && newEntry.IsAvailable;
});

if (freed.length === 0) {
    console.log("No changes for watched dates");
    process.exit(0);
}

const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

if (!token || !chatId) throw new Error("TELEGRAM_TOKEN or TELEGRAM_CHAT_ID is not set");

const lines = freed.map(date => {
    const d = Object.values(newDates).find(e => e.Date === date);
    return `📅 ${date} — ${d.TotalAvailable} places available`;
});

const message = `🟢 Pinnacles Hut spots opened up!\n\n${lines.join("\n")}`;

fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message })
})
    .then(r => r.json())
    .then(r => {
        if (!r.ok) throw new Error(JSON.stringify(r));
        console.log("Telegram notification sent");
    });
