# Judge review — MicroMatch (team Microscope)

Reviewed 7 Nov 2026, about 15:00 Sydney time, on the local tree (`main`, already even with `origin/main` except one unpushed docs commit). Nothing in the repo was edited except this file. The proxy was stopped for the offline check and started again; `http://127.0.0.1:3000/health` returned ok and the key check passed.

Method: fresh Chrome-for-Testing profile, unpacked `./extension`, live Domain listings, signup and quiz on `http://localhost:3001`. Branded Chrome Beta 158 ignored `--load-extension`. Computer Use was waiting on a permission prompt, so the person’s already-open Chrome Beta was not driven. realestate.com.au did not render in this browser.

## What would cost points at 15:30

1. **Held-out check is still the placeholder.** `report.html` lines 208–230 still say `HELD_OUT` and “Pending — not entered”. The task asks for your own held-out count. This is the largest paperwork hole.
2. **realestate.com.au was not shown working.** The Surry Hills sale URL and the REA search both came back as an empty document (no title, no `h1`, body length 0). Domain worked. A judge who only opens REA has nothing from this pass to rely on.
3. **The panel’s facts are narrower than the task sheet.** On a matched home it shows a personal fit, sourced rent, and a bus distance. It does not show bed/bath/parking, a value range, three sales, or a DA. Beds exist in the API and are simply not drawn. AVM and nearby sales were honestly empty on the Zetland unit the report uses (`data: null` / `available: false`). There is no `da-list` call under `proxy/`.
4. **Small report mismatches** (section below). None of them are a wrong home or a made-up dollar figure.

What would not cost points: the three Domain matches were the right homes, the no-profile gate shows no score, the quiz score appears, “Not this one?” opens the type box, and the three failure states behave. No hard-rule breach found.

## Listings

| Listing | Portal | Page address | Panel match | No profile | After quiz | Not this one? |
|---|---|---|---|---|---|---|
| https://www.domain.com.au/59-portman-street-zetland-nsw-2017-17904853 | Domain, Zetland | `h1` “59 Portman Street, Zetland NSW 2017”; JSON-LD “59 Portman Street” | **Pass.** “59 Portman Street”, exact, `GANSW706360735`. Geocode top hit is the same id, “59 Portman Street, Zetland”, house. | **Pass.** Login card plus “Take the quiz to see your fit”. No speedo, no rent, no distances. | **Pass.** Fit 45. Rent $1,600/wk (advert 2025-12-17), bus 167 m, supermarket/gym/café 3 of 3. | **Pass, empty list.** Picker opens, 0 other candidates, type box visible. |
| https://www.domain.com.au/110-11-wigram-lane-glebe-nsw-2037-2020659759 | Domain, Glebe | `h1` “110/11 Wigram Lane, Glebe NSW 2037”; JSON-LD “110/11 Wigram Lane” | **Pass.** “Unit 110, 11 Wigram Lane”, exact, `GANSW718322210`. Geocode top hit is “UNIT 110/11 Wigram Lane, Glebe (NSW)”, unit. | Not re-shot on this URL. Same build passed on Portman. | **Pass.** Fit 46. Rent $1,700/wk as of 2025-01-06, bus 162 m. Both match the API for that id. | **Pass, empty list.** Same as Portman. |
| https://www.domain.com.au/19-alexander-street-surry-hills-nsw-2010-2021308602 | Domain, Surry Hills | `h1` “19 Alexander Street, Surry Hills NSW 2010” | **Pass.** “19 Alexander Street”, exact, suburb Surry Hills, `GANSW705980792`. Geocode top hit is that id, house. Next hits are other streets. | Panel DOM not opened on this tab. Match was returned with no profile stored. | Not scored in this pass. | Not clicked. |
| https://www.realestate.com.au/property-apartment-nsw-surry+hills-147399572 and the Surry Hills buy search | REA | Empty document | **Not judged** | Not judged | Not judged | Not judged |
| https://www.domain.com.au/19-22-28-penkivil-street-bondi-nsw-2026-2021308970 | Domain, Bondi (outside) | `h1` “19/22-28 Penkivil Street, Bondi NSW 2026” | **Pass (out of area).** “MicroMatch covers the City of Sydney only for now.” No crash, no figures. | — | — | — |

“Not this one?” does not offer another candidate when the proxy returns none. On these exact matches that list was empty. Typing `99999 Nowhere Lane, Surry Hills NSW` then returns “We couldn’t find that address” and leaves the type box up. **Pass.**

## Facts checked against the API

Listing used: 59 Portman Street, Zetland, `GANSW706360735`. Called with the team key against `https://api-ht.microburbs.com.au` (same paths the panel prints).

| Shown on the panel | Endpoint | API | Result |
|---|---|---|---|
| Rent $1,600/wk, latest advertised rent, 2025-12-17 | `GET /v1/properties/GANSW706360735/rent-history-latest` | `price` 1600, `date` 2025-12-17, `address` “59 Portman Street” | Match |
| Bus 167 m, `/transport/nearby` | `GET /v1/properties/GANSW706360735/transport/nearby` | `nearest.bus.distance_m` 167, label “Bus stop”, no stop name | Match |
| Supermarket, gym, café · 3 of 3, `/lifestyle/pois` | `GET /v1/suburbs/Zetland/lifestyle/pois` | all three subtypes sit within 800 m of the property centre (580 features, count equals returned) | Match |

107% of income is 1600 / 1500 from the quiz income entered in this pass, not a fourth API field.

Same-day check of the report’s Zetland unit, not re-opened as a listing: `401/2 Victoria Park Parade, Zetland` geocodes first to `GANSW718567980`, “UNIT 401/2 Victoria Park Parade, Zetland”. Live proxy lookup: exact, display name “Unit 401, 2 Victoria Park Parade”, suburb Zetland, 0 candidates, **14 signals available and 4 unavailable** (hazards, social housing, AVM, comparable value). Rent advert `price` 1100 on `2025-02-06`. `GET .../valuation/avm` is `available: false`, “No AVM”. That matches the report’s 14-of-18 table and the February 2025 rent. The panel text a judge sees is a different fraction (“9 of 15” / “10 of 15 scored”). That is the scorer dropping empty signals, not a second measurement of the 18.

`basics/all` for Portman is 3 bed, 2 bath, 1 parking, house. The panel’s facts line stayed blank, so those numbers never appear. Glebe rent 1700 on 2025-01-06 and bus 162 m also matched the API.

## Failure states

| Case | Result |
|---|---|
| Proxy on port 3000 stopped, Portman tab reloaded | **Pass.** Record `status: error`, `code: offline`, message “Backend offline”. Panel: “Backend offline — retry”. No dollar figures. |
| Bondi listing above | **Pass.** Calm out-of-coverage sentence. |
| Typed nonsense address | **Pass.** “We couldn’t find that address.” Type box still there. |

## Hard rules

No violation found.

- The content script’s only outbound message is the address string and a listing flag (`extension/src/content.js` 112–116). `extract.js` reads JSON-LD (`extract.js` 157–169) and the address `h1` (`extract.js` 187–200), which the brief allows, and keeps address strings only. It does not read price, description, or images. The URL path is used only to rank those address strings (`extract.js` 205–214).
- `extension/dev/*.mjs` mentions `innerText` and an `h1`. Those files are not in `manifest.json`. They read the panel and the heading, not listing price or photos.
- `git grep` of tracked files found no live key. `proxy/.env` and `backend/.env` are ignored (`.gitignore` line 2). The key is set only in `proxy/.env`. `backend/.env` has an empty key.
- `data/addresses-city-of-sydney.csv`, `data/public-housing-homes-city-of-sydney.csv`, and `data/task.zip` are on disk and ignored (`.gitignore` line 8). `git ls-files` does not track them, any `*.csv`, or a fixture file of live API output. Test gnaf ids in `extension/sidepanel/score.test.js` are synthetic.

## False or unfinished claims

| Claim | Where | What was observed | Rank |
|---|---|---|---|
| Held-out result `HELD_OUT`, every row “Pending — not entered” | `report.html` 208–230 | Still unfilled past the report’s own 14:50 note | High. Missing required check, not a wrong number. |
| Matched to “Unit 401, 2 Victoria Park Parade, Zetland” | `report.html` 176 | Proxy and the proof shots show “Unit 401, 2 Victoria Park Parade”. Suburb is a separate field. Same gnaf, exact, no other candidates. | Low |
| Social-housing estimate “(not connected)” | `report.html` 183 | `proxy/facts/safety.js` 84–145 does call the local CSV. The signal stays unavailable when `housingShare` returns null. The file is present on this machine. “Not connected” is stronger than the code. | Low |
| Panel labels the Zetland rent “weekly basis assumed” | `report.html` 197 | The proxy label contains that phrase (`proxy/facts/price.js` 110). The panel text and `tools/shots/proof-quiz-A.png` show “latest advertised rent” plus the date, not that phrase. The date and $1,100 are right. | Low |
| Quiz button opens `http://localhost:3001` | `README.md` 17 | `extension/sidepanel/panel.js` 224 opens `http://localhost:3001/quiz` | Negligible |

These README and report statements matched this pass: no score and no speedo before a profile (`README.md` 17); “Backend offline — retry” (`README.md` 35); City of Sydney only (`README.md` 119); 14 of 18 and February 2025 rent (`report.html` 176–197); test counts 125, 12, 14 (4+10), and 11 (`report.html` 170–173), re-run here with the same commands, all green.

`tools/shots/proof-quiz-A.png` and `proof-quiz-B.png` show fit 38 (Ava, renting) and 60 (Ben, buying) on Unit 401. This pass did not recreate those two personas. It did show two different fits (45 and 46) on two homes for one new quiz account.

## README, as a stranger

The running stack matches the README: proxy `:3000`, Django `:8001`, site `:3001`, unpacked `./extension`, signup and quiz on `:3001`, profile landed in `chrome.storage.local` and the panel scored. A cold `./run.sh` from empty `node_modules` / a new virtualenv was not repeated; those directories were already present. The Load unpacked steps are what a current Chrome needs. The key path (`proxy/.env`, gitignored, proxy-only) is correct and was already filled.
