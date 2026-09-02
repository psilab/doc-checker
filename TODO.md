# TODO

## 1. Evaluate alternative Tyler RDR endpoints

`fetch.js` currently calls `{API_BASE_URL}/{facilityId}/startdate/{today}/nights/120/1`
(an `occupancygrid` path) and stores daily totals.

Platform background is in `NOTES.md`. In short: **UseDirect** (US eDirect, acquired by Tyler Technologies 2022; product
"Recreation Dynamics"). DOC is tenant `NewZealand` on
`https://prod-nz-rdr.recreation-management.tylerapp.com/nzrdr/rdr/`.

Endpoints worth comparing against what we use today — full map in
<https://github.com/rawazer/greatwalk-bot> (`docs/api.md`):

| Endpoint | Why it might be better |
|---|---|
| `POST search/grid` | per-**unit**, per-day slices (`IsFree`, `IsBlocked`, `Lock`) instead of daily totals — would let us tell "1 bunk left" from "8 bunks left" per bunk |
| `GET search/next/{facilityId}/startdate/{date}/nights/{n}` | next available date directly; cheaper than scanning 120 days |
| `GET search/bookingwindow` | server time + `FutureBookingStarts`/`Ends`; would remove hardcoded assumptions |
| `GET search/details/{facilityId}/startdate/{date}/nights/{n}/{customerId}/{classId}` | documented sibling of the current call |

Notes:
- Read endpoints need no auth (anonymous `customerId=0`).
- WAF caveat: direct HTTP clients can get `405` + AWS WAF CAPTCHA HTML. Our current
  spoofed UA + `Referer`/`Origin` headers get through — keep them on any new call.
- `juftin/camply` has a `UseDirectProvider` covering 12 agencies (CA, FL, OH, VA, AZ,
  MO, MN, AL, Maricopa, Fairfax, Oregon Metro, AU Northern Territory) but **not NZ DOC**.

## 2. Auckland Council regional parks — DEFERRED

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
