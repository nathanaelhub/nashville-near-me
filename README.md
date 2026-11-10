# Nashville Near Me

**What's happening near me?** Type a Nashville address and see the rezonings, zoning appeals and
building permits around it, straight from Metro Nashville's public records.

**Live site:** https://nathanaelhub.github.io/nashville-near-me/ (mirror: https://nashville-near-me.vercel.app)

Most residents learn about a rezoning from a sign in a yard, a week before the hearing. The records
are all public, but they're spread across Metro Planning's Development Tracker, the Board of Zoning
Appeals and Metro Codes, each with its own map. This puts them on one page for one address.

## What it shows

| Section | Source (Metro ArcGIS layer) | What counts as current |
|---|---|---|
| Zoning and planning cases | Planning's Development Tracker | Cases still open (new, pending, active) |
| Zoning appeals | Board of Zoning Appeals cases | Heard in the last year, or scheduled |
| Building permits in review | Codes: permit applications | Filed in the last year, not yet issued |
| Building permits issued | Codes: permits issued | Issued in the last year |

Upcoming Planning Commission and BZA hearings go to the top, soonest first. When a planning case
became a council bill covered by the [Nashville Council Digest](https://github.com/nathanaelhub/nashville-council-digest),
it links to that bill's fact-checked, plain-language page. The address's council district links to
the digest's district page.

## How it stays honest

- **No AI text.** The descriptions are Metro's own words. The only labels added are fixed ones for
  case types ("Specific Plan: custom zoning written for one site"), written once and tested.
  Plain-language summaries appear only through the Council Digest, where every summary is checked
  against the bill text before it's published.
- **No server.** The page asks Metro's public map service directly from the browser, so the
  results are as fresh as Metro's data (on Nov 9, 2026 the permit layers held permits through the
  day before) and no one stores what you search.
- **Privacy.** Queries request named fields only, never owner, appellant or contact names (a test
  enforces it). Phone numbers and email addresses that contractors leave in permit notes are removed
  before display.
- **Addresses** are matched against Metro's parcel map; when the exact house number isn't on file,
  it uses the closest one on the same street (within 200) and says so. An address that exists in
  two parts of the county asks which one you mean instead of guessing.

## Findings

- **Zoning appeals are rare.** About 50 were heard or scheduled countywide in the last year, so
  most addresses show none. That's the data, not a bug: the query was checked against a known
  case's location.
- **Permit notes carry personal phone numbers.** Contractors write "POC: name, phone" into the
  public description field. They're public records, but there's no reason to republish them.

## Stack

- **Static HTML, CSS and JavaScript modules**, no build step and no dependencies
- **Data:** Metro Nashville's public ArcGIS REST layers (Parcels, Development Tracker, BZA, Codes permits)
- **Tests:** `node --test` (Node 20+)
- **Hosting:** GitHub Pages, mirrored on Vercel; both deploy on every push to `main`

## Run

```bash
cd nashville-near-me
python3 -m http.server 8000   # -> http://localhost:8000
npm test                      # offline tests of the parsing, queries, redaction and sorting
```

Links like `?address=1 Public Square&r=0.5` open straight to the results, so a search can be shared.

## Limits

- It covers what Metro publishes in these four layers. Short-term rental permits, right-of-way
  work, historic commission permits and demolitions without a permit are not included.
- Distances are straight-line from the parcel's center point.
- Not affiliated with Metro Nashville. Always confirm with the official record.
