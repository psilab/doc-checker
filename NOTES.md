# Notes on the upstream booking systems

Findings about how DOC's (and Auckland Council's) booking systems work internally.
Reference material — not tasks. See `TODO.md` for work items.

## DOC runs on UseDirect / Tyler "Recreation Dynamics"

`bookings.doc.govt.nz` is a tenant (`enterpriceName = 'NewZealand'`) of **UseDirect**
(US eDirect), a NY company acquired by Tyler Technologies in Feb 2022 and productised as
"Recreation Dynamics". Roughly 40 agencies across the US, Canada, Australia and NZ.

- JSON API host: `https://prod-nz-rdr.recreation-management.tylerapp.com/nzrdr/rdr/`
- ASP.NET front end: `https://bookings.doc.govt.nz/Web/`

Tells that it is a North American product wearing a DOC skin:

- `dateTimeCulture = 'en-ca'` — a Canadian locale, which is why `SaveWaitListInfo` has a
  dd/mm parsing branch. On the other branch `01/10/2026` would be read as 10 January.
- "Province/State/Region" and "Postal/Zip code" on the NZ profile form.
- A "Required ADA Sites" checkbox — ADA is the *Americans with Disabilities Act*.

Same codebase, other tenants: `reserve.floridastateparks.org`, ReserveCalifornia, Ohio /
Minnesota / Missouri / Virginia / Arizona / Alabama state parks, Maricopa and Fairfax
counties, Oregon Metro, Australia's Northern Territory, Queensland Parks and Wildlife.

## DOC has a hidden availability-alert feature

**Status: exists, reachable, unknown whether it actually delivers.**

Contrary to several articles claiming DOC has no waitlist at all, the machinery ships with
the platform and is wired up on DOC's deployment. It is only the button that is missing.

### What is there

A modal titled **"Create Notification"** sits in the markup of every booking page:

> "Use the fields below to create a notification alert. If a site becomes available you
> will receive an email notice."

Fields: From Date / To Date (range must be <= 30 days), Facilities, Unit, Preferred Contact
Method ("E-mail me"), Required ADA Sites.

- Opened by `globalThis.showAndSetUpWaitList(placeId, facilityId)`.
- Requires a session. Logged out it sets `showWaitListPopup = true`, opens the login modal,
  and re-fires itself automatically after sign-in.
- Facility dropdown is populated from `localStorage.SelectedPlace`, so the place page has
  to have been visited first.
- Saves via `POST /Web/Default.aspx/SaveWaitListInfo` with
  `{StartDate, EndDate, PlaceId, FacilityId, UnitTypeId, PreferredContactType, IsADAReuired}`.

### Why it is not findable in the UI

The `"Notify Me!"` link that calls it is rendered behind a client-side flag in `main.js`
(`A.g(!0,b) ? ... "Notify Me!" : null`), positioned next to the "Next available date"
toggle on the facility card under "Other Facilities".

That flag is off for Peach Cove Hut (place 753, facility 2502) and Pinnacles Hut
(728 / 2422) — both checked logged out. It is **cosmetic only**: calling the function
directly from the console produced the modal, and `SaveWaitListInfo` accepted facility
2502 and returned *"Waitlist added successfully."* There is no matching server-side check.

### Nothing can manage what you create

- Account menu is Great Walk Bookings / Other Bookings / My Profile / My Passes. No
  notifications entry, and the profile page has no notification section.
- `SaveWaitListInfo` is the only waitlist WebMethod in the bundle — no get, list or delete.
  By contrast the draw/lottery feature does ship `CancelDrawApplication`.
- Probed `Customers/WaitList.aspx`, `WaitListInfo.aspx`, `Notifications.aspx`,
  `MyWaitList.aspx`, `Notification.aspx`, `/WaitList.aspx` — all 404. (`Customers/Profile.aspx`
  returns 302 to Login, so the probe does distinguish real pages from missing ones.)
- Florida State Parks, a different tenant with the feature visibly enabled, has an
  identical bundle: same nine waitlist identifiers, same seventeen WebMethods, same customer
  pages. So create-only is upstream in UseDirect, not a DOC omission.

### Still unknown

- **Whether the emails actually go out** for these facilities. A saved row is not a working
  alert, and the missing management UI suggests the feature is only half-wired.
- Management surfaces we cannot see from outside: a staff/cashier back office
  (`LoginByEmail_Cashier` and `LogoutCashierCustomer` exist), or an unsubscribe link inside
  the notification email itself.

### Test entry in flight

Created 2026-09-03: Peach Cove Hut, 1-31 Oct 2026, any unit, email contact. The scraper in
this repo is the control group — if an email ever beats the Telegram bot to a cancellation,
the feature works. The row carries `EndDate: 2026-10-31` so it should expire on its own
(inferred from the payload, not confirmed).

## Tyler RDR endpoints — evaluated 2026-09-03

Conclusion: the call we already make is the right one. Everything else is worse or redundant.

`API_BASE_URL` is `https://prod-nz-rdr.recreation-management.tylerapp.com/nzrdr/rdr/search/occupancygrid`.
It answers plain curl with the spoofed UA + `Referer`/`Origin` that `fetch.js` already sends —
no WAF challenge observed, despite the warning in the greatwalk-bot notes.

| Endpoint | Result |
|---|---|
| `GET search/occupancygrid/{id}/startdate/{d}/nights/{n}/1` (current) | 12 fields per day: `TotalAvailable` (people), `TotalAvailableUnit` (bunks), `MaxOccupancy`, `UnitCount`, `ReservationCount`, `PersonCount`, `LockCount`, `InSeason`, `IsBlocked`, `IsWalkin`. We consume 4. |
| `POST search/grid` | 200. Per-unit metadata (8 named bunks, `IsAda`), but `Slices` came back empty for a guessed body. Even working it would need re-aggregating to produce numbers occupancygrid hands over directly. Not an upgrade. |
| `GET search/next/{id}/startdate/{d}/nights/{n}` | 200 — `AvailableUnits` and `CountsByUnitId`, but for **one** date range only. Covering our window would take ~1 call per day. Only answers "next free date", which is derivable from data we already hold. |
| `GET search/bookingwindow` | 200 — global `ServerStamp` / `FutureBookingStarts` / `FutureBookingEnds`. Redundant: occupancygrid already returns per-facility `Restrictions.FutureBooking*`. |
| `GET search/details/{id}/startdate/{d}/nights/{n}/{customerId}/{classId}` | 500 with the documented parameter shape. |

### The horizon was the real problem

occupancygrid returns as many nights as asked (tested 120 / 180 / 200 / 365). The current
booking season runs to 2027-06-30 — `InSeason` is true for 301 days from 2026-09-03 — and
real reservations already exist well past the old fixed 120-night window, which stopped at
2026-12-31.

`notify.js` matches watched dates with `.find(d => d.Date === date)`, so **any watched date
beyond the fetched window simply never matched** — no error, no notification, ever. A date
added for, say, March 2027 would have looked configured and done nothing.

Fixed 2026-09-03: `fetch.js` derives nights per hut from its furthest watched date (floor
120, cap 365, warns past the cap), so only huts that need a longer window pay for it —
120 nights is ~30 KB per hut, 365 nights ~89 KB, and `data/` is committed on every change.
`notify.js` now warns when a watched date is missing from the data.

Side note: `fetch.js` builds `today` from `toISOString()` (UTC), so in NZ the window starts a
day early. Harmless and self-consistent — the same `today` feeds both the request and the
night count — but inconsistent with the `localDate()` timezone fix used in the calendar.

## Auckland Council regional parks — wired up 2026-09-03

Second source alongside DOC, live for Tāwharanui campground. Their booking front end is a
Next.js app at `www.aucklandcouncil.govt.nz`; the availability API sits on a separate host.

### The endpoint

```
GET https://experience.aucklandcouncil.govt.nz/nextapi/accommodations
    ?reqType=availability&productId={pid}&firstDay={stamp}&lastDay={stamp}
Authorization: Bearer {token}
```

`{stamp}` is a **local wall-clock time with no zone**, `YYYY-MM-DDTHH:mm:ss`. The site's own
formatter builds the first day at `01:00:00` and the last at `23:59:59` — the 01:00 dodges
the DST-transition hour, and copying it exactly is free insurance.

Response is a flat array, one entry per night:

```json
[{ "capacity": 91, "date": "2026-09-03T00:00:00" }]
```

### What the TODO got wrong

The plan assumed three opaque states (available / some spaces / unavailable) and **no seat
count**, so `notify.js`'s `TotalAvailable > 1` rule would have had no equivalent. Not so:
`capacity` is a real headcount, and it maps straight onto DOC's `TotalAvailable`. The three
states are a *rendering* decision made client-side, not the shape of the data.

From the page bundle, their calendar does:

- `capacity <= 0`, or the date is past → unavailable
- `0 < capacity < partySize` → "some spaces available" for three-state types, unavailable
  for two-state ones
- `capacity >= partySize` → available

and the split is by accommodation type: `Bach`, `Tiny home`, `Lodge`, `Glamping` and `Tent`
are two-state, everything else (campgrounds) is three-state. That is a whole-unit booking
versus a per-person one.

A first guess that whole-unit types report capacity 1 or 0 turned out to be wrong: Tāwharanui
Bach reports its **bed count**, and over 179 days it is 0 on 167 of them and 6 on the other
12 — never anything in between. So the number is always a headcount; what the type tells you
is whether a *partial* count is possible. Hence `minFree()` in `notify.js` and `index.html`:
a hut or campground needs two free spaces to be worth a message, since one leftover bed is
no use to a party, while for a whole-unit type any free space at all means the entire place
came free.

**Capacity can be negative** (-290 seen on Tāwharanui). Overbooking or a closure marker;
either way it is clamped to 0 on read rather than reasoned about.

Also present: `reqType=unavailability` (returns `remainingCapacity` for unavailable days —
strictly redundant) and `reqType=prices`.

### The bearer token

A **public** short-lived JWT — payload is just `{sessionId, exp}`, ~15 minutes, handed to
any anonymous visitor. It ships as `initialToken` in the server-rendered payload of an
**accommodation-details page only**; the homepage, `stay-at-park` and `find-accommodation`
carry no token. One token per run, reused across properties and months.

The page is 5.5 MB (560 KB gzipped) but the token sits at ~1.2% of it, so `fetch.js` streams
the response and stops reading as soon as the token matches. The regex requires the closing
quote — without it a chunk boundary can hand back a truncated token.

There is a Next.js server action `getSessionToken` (id `0032ed5e…`) that would return the
token for ~1 KB, but server-action ids change on every deploy and would break silently.
Not worth it for one call a day.

### The 406 wall

`www.aucklandcouncil.govt.nz` sits behind a Fastly bot filter that answers plain curl,
plain Node `fetch`, and a bare spoofed User-Agent with `406 Not Acceptable`. **No single
header gets through** — `Sec-Fetch-*`, `Upgrade-Insecure-Requests`, `sec-ch-ua`,
`Accept-Language` and `Accept-Encoding` were each tried alone and each failed. It wants the
whole shape of a Chrome navigation at once, which is what `AKL_PAGE_HEADERS` sends. The API
host itself is not behind the filter and needs only `Origin`/`Referer`.

### Windows and limits

- **Booking window is six months** for campgrounds ("Bookings can only be made six months in
  advance"), and availability refreshes at midnight daily. The API answers past that, but
  with raw capacity rather than anything bookable — hence the warning in `aklMonthsFor()`.
- **Max span per call is ~61 days** (62 is rejected with `exceed max date range`). `fetch.js`
  asks month by month anyway: calendar-aligned months match what their own site does and
  have no edge cases, at the cost of six requests instead of three.
- Errors come back as **HTTP 200** with an error object in the body, so the response shape
  is the only reliable check.

### Enumerating properties

There is no cheap listing. `find-accommodation.html` renders its results client-side from
Coveo, so no served HTML contains the ids. A property's `productId` has to be read out of
its own page, next to `accommodationAsCF`.
