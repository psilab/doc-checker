# TODO

## 1. Auckland Council regional parks — more properties

The plumbing is in (see `NOTES.md` for how the API works). Only Tāwharanui campground
(`79` / `220233`) is wired up. Adding another is a `config.json` entry plus its `productId`,
which lives in the property page's HTML next to `accommodationAsCF`.

Resolved already, if they turn out to be wanted:

| id | productId | type | name |
|---|---|---|---|
| 16 | 220042 | Camping | Peninsula campground, Āwhitu |
| 62 | 220191 | Bach | Graham Bach, Scandrett |
| 76 | 220230 | Bach | Tāwharanui Bach |

There is no cheap way to enumerate the full ~120-property list: the find-accommodation page
renders its results client-side from Coveo, so the ids are not in any served HTML. Resolving
a new one means loading its property page, which is 5.5 MB (560 KB on the wire).

## 2. Christmas at the campground

January 2027 is now watched via `watchStays` (any three nights together). Christmas week is
just as solidly booked and is not watched by anything — worth deciding whether it wants a
second `watchStays` entry over late December.
