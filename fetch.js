const fs = require("fs");

async function run() {
    const url = "https://prod-nz-rdr.recreation-management.tylerapp.com/nzrdr/rdr/search/occupancygrid/2422/startdate/2026-03-22/nights/90/1";

    const res = await fetch(url, {
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Referer": "https://prod-nz-rdr.recreation-management.tylerapp.com/",
            "Origin": "https://prod-nz-rdr.recreation-management.tylerapp.com",
            "X-Requested-With": "XMLHttpRequest"
        }
    });

    console.log("Status:", res.status, res.statusText);

    const text = await res.text();
    console.log("Raw response preview:", text.slice(0, 500));

    if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
    }

    if (!text.trim()) {
        throw new Error("API returned empty response");
    }

    let data;
    try {
        data = JSON.parse(text);
    } catch (err) {
        console.error("Response is not valid JSON:");
        console.error(text);
        throw err;
    }

    delete data.Message;

    fs.writeFileSync("data.json", JSON.stringify(data, null, 2) + "\n");
    console.log("data.json updated");
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
