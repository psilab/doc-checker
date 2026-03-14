const fs = require("fs");

async function run() {
    const url = "https://prod-nz-rdr.recreation-management.tylerapp.com/nzrdr/rdr/search/occupancygrid/2422/startdate/2026-03-22/nights/7/1";

    const res = await fetch(url);

    if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
    }

    const text = await res.text();

    if (!text) {
        throw new Error("API returned empty response");
    }

    let data;

    try {
        data = JSON.parse(text);
    } catch (err) {
        console.error("Invalid JSON received:");
        console.error(text);
        throw err;
    }

    fs.writeFileSync("data.json", JSON.stringify(data, null, 2) + "\n");

    console.log("data.json updated");
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
