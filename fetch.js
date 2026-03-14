const fs = require("fs");

async function run() {
    // const res = await fetch("https://api.example.com/data");
    const res = await fetch("\n" +
        "https://prod-nz-rdr.recreation-management.tylerapp.com/nzrdr/rdr/search/occupancygrid/2422/startdate/2026-03-22/nights/7/1");

    if (!res.ok) {
        throw new Error(`API request failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();

    fs.writeFileSync("data.json", JSON.stringify(data, null, 2) + "\n");
}

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
