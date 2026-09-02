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
