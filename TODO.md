# TODO

## 1. Auckland Council regional parks — DEFERRED

Second source alongside DOC: campgrounds, baches, lodges, glamping in Auckland regional parks.

- Property pages: `https://www.aucklandcouncil.govt.nz/en/parks-recreation/stay-at-park/find-accommodation/accommodation-details/{id}.html`
- Known ids: `16` Peninsula campground / Āwhitu (`productId` 220042), `62` Graham Bach /
  Scandrett (220191), `76` Tāwharanui bach, `79` Tāwharanui campground.
- Availability API (one month per call):
  `https://experience.aucklandcouncil.govt.nz/nextapi/accommodations?reqType=availability&productId={pid}&firstDay={ISO}&lastDay={ISO}`
- Auth: `Authorization: Bearer <token>` — a **public** short-lived JWT embedded in the HTML
  of any Auckland Council page (one JWT-shaped string, ~157 chars). Scrape it per run and
  reuse across properties. Also send `Origin`/`Referer` of `www.aucklandcouncil.govt.nz`.
  Prior art for the same host: <https://github.com/thecolab-ai/.skills> (`skills/auckland-bin-schedule`).
- No-auth fallback: the **current month only** is server-rendered into the property page
  HTML (`class="date available|some-available|unavailable"`). Month cannot be shifted by
  query param.
- Booking window is 6 months; availability refreshes at midnight daily.
- Data shape differs from DOC: three states (available / some spaces / unavailable), **no
  seat count**. So `notify.js`'s `TotalAvailable > 1` rule has no equivalent — trigger
  would just be `unavailable -> available`.
- Their notes ask to avoid high-volume scraping: one token fetch per run, few properties.

Open questions before starting: which properties to watch; whether to add a `source`
field (`"doc"` / `"akl"`) to `config.json` and normalise both into one internal day shape.
