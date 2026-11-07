# Chrome Extension Plan — competitor research and product thinking (teammate, 6 Nov 2026)

Source material for report.html. Product direction has since moved to the Fit panel (see README.md); the competitor table, portal-vs-panel gap analysis, hard rules and matcher notes still apply.

---

Microburbs Hackathon — Chrome Extension Plan
6 Nov 2026 · @Someone
TL;DR
Build Microscope: a side panel that opens beside any realestate.com.au or Domain listing in the City of Sydney, matches the exact home down to the unit, and shows the four things the listing will never tell a buyer.
1. What it's really worth — Microburbs valuation, its range and confidence, plus what the vendor paid and when.
2. What the listing doesn't say — only the risks that sit on this property, and whether it was listed before and pulled.
3. Your building — for apartments: other units in the same building for sale right now, what units there sold for, and the building's ownership mix.
4. Questions to ask the agent — three pointed questions generated from the facts above.
Why this can win:
• It's built for the area. The supplied file for task 5 holds 181,711 flats out of roughly 209,000 addresses, so most listings judges open will be units. Most teams will match the street and miss the unit.
• It scores on exactly what judges check: the right home, the right facts, and facts buyers can't already see on the portal.
• Its clever step is building-level data, which no Australian property extension I found offers.
• It's pitched to the real customer: the founder with ~52–54k downloads who wants Microburbs data and branding inside his extension. Build it as a drop-in panel and say so.
On difficulty: the extension itself is the easy part, roughly 200 lines with no prior experience needed. The hard part is matching the address and picking facts that matter.
Cut for tomorrow: the central portal, the AI quiz and draggable widgets. They're roadmap, not winners (see Your three ideas).
What the brief actually rewards
The task page is short, but three lines in it decide the winner: judges open real listings and check the matched address, they check the facts against that exact home, and they judge whether the facts add value for buyers.
Hard rules (break one and you lose points or get excluded)
• Read only the viewed address from the page, or ask the user to type it. Don't collect or copy listing text or photos. This means you cannot read the asking price off the page.
• Get the facts from the Microburbs API after matching the address.
• Keep the API key, the supplied CSVs and API output out of the public repo. The getting-started page says to call the API from a server so the key never reaches the page.
• Coverage is the 29 City of Sydney suburbs only. Anything else returns 403, so demo on listings in Surry Hills, Waterloo, Zetland, Glebe, Pyrmont and so on.
• Don't scrape any site whose terms forbid it.
How it's judged
• The extension works end to end on several real listings, picked by the judges.
• Matched address and facts are checked against the correct home.
• Facts are judged on value to a browsing buyer.
• Pitch, demo and report all count; this task has no scored CSV.
• The guide says a clever, non-obvious step beats polish.
• An AI first pass picks up to 25 pitch videos for the room. Your 45-second pitch is the gate to the final five.
Hand-in by 3:00 pm (one public repo)
• README.md: what you built, who it helps, the data, the clever step, how to run it.
• report.html: compare existing extensions with the property sites, show what buyers already see, explain your added value and why you chose those facts, plus method, what worked, what didn't and your own held-out check.
• pitch.mp4 (45 s max) and demo.mp4 (3 min max), each under 95 MB.
The day: Saturday 7 November at UTS Business School, Level 2, 14 Ultimo Road. Team key, address list and public-housing flags arrive at 11:00; submissions close at 3:00; top five demo at 3:30; winners at 4:00. First prize is $2,000 cash split across the team, second is $10,000 in API credits, and top teams get interviews with Microburbs.
How hard is a Chrome extension?
Not hard. If you've shipped Django or Next.js apps, a working extension that shows data beside a listing is a one-to-two-hour job with Claude Code. The skill is in matching the address and choosing the facts, not in the extension.
Part
Difficulty (1–5)
Time with Claude Code
Extension skeleton: manifest, content script, side panel
1
30 min
Proxy that holds the key and calls the API
1
20 min (reuse the demo's)
Reading the address on REA and Domain, incl. page changes
2
45 min
Matching units correctly ("105/8", "Level 1", ranges)
3.5
60–90 min
Choosing and wording facts that win
4
the rest of the day
The anatomy is four files plus a tiny server.
1. manifest.json — Manifest V3. Declares the side panel, storage, your proxy under host_permissions, and content scripts for realestate.com.au/property-* and domain.com.au/*.
2. Content script — runs on the listing page and reads only the address (the main heading; on Domain the URL slug carries it too). Sends it to the background.
3. Background service worker — receives the address, calls your proxy, caches the result, updates the panel.
4. Side panel (sidepanel.html + JS) — the UI. Chrome's Side Panel API docks it beside the page, so you never inject into the portal's layout.
5. Proxy — 30 lines on Vercel or Cloudflare. The Microburbs Next.js demo (MIT) already has an /api/mb/[...path] route that forwards /v1/ calls; deploy it with your key.
For the demo you load it via chrome://extensions → Developer mode → Load unpacked. No Web Store publishing.
Gotchas that eat hackathon time
Gotcha
Fix
Portals swap listings without a page reload, so the content script doesn't re-run
Watch for URL changes and re-read the address
Content scripts can't freely call other origins
Do every fetch in the service worker
Anything inside the extension is readable by the user
Key lives only on the proxy
The service worker sleeps after about 30 s idle
Keep state in chrome.storage.session, not in variables
Addresses come as "105/8 Sam Sing St", "Unit 105, 8 …", "8–10 …", or "Address on request"
Normaliser, a candidate picker, and a type-it fallback
Out-of-area listings return 403
A friendly "outside the City of Sydney trial area" state
Competitor landscape
Australian property extensions are almost all about price: hidden guides, guide changes and listing history. Nobody puts risk overlays, street-block data or building-level apartment data beside a listing, and that's the gap.
Extension
Sites
Users
Rating
What it does
What it doesn't do
Homer (formerly KoalaData)
REA, Domain
10,000
4.7 (96)
Hidden guide prices, guide changes, campaign history, agent sold-to-guide patterns. Freemium. Has a web and mobile workspace to shortlist, compare and take notes
Valuation, rent, crime, risk overlays, schools; nothing unit- or building-specific
Property Seeker
REA, Domain, realcommercial
~10,000
4.7 (37)
Hidden prices, property.com.au estimate, Walk Score, hide listings
Anything beyond price and walkability
PriceDaddy!
REA only
1,000
4.4 (14)
Price guide, $/sqm, walk and transit scores, NBN type, days on market, page views
Risk, building, valuation; last updated June 2024
Property Buddy
REA, Domain
402
3.4 (5)
A buyers agency's property score, market insights, compare
Transparent facts; it's a lead-gen tool
Real Price
REA
not shown
not shown
Finds the hidden price by re-querying REA search
Anything else
Long tail: Properly, TruePrice, READevil, Tell 'em They're Dreaming
REA, Domain
4–13 each
none
Price guessing and guide tracking
Same gap
Overseas, the closest analogue is the UK's Area360, with about 9,000 users on Rightmove and Zoopla. It shows sales history, crime, income, social housing, flood risk, noise and schools beside listings, which proves buyers want neighbourhood and risk facts in this format. The UK's Property Log is the cautionary tale: it surfaced price cuts Rightmove hid, and agents pushed back.
What this means for you:
• Don't fight Homer on price history. It has a 10,000-user head start and a full workspace. Its store count matches the brief's "rival listing-history extension" with about 10,000 users.
• Avoid price-reveal tricks. They re-query the portal, which this brief rules out.
• Own the facts the portals and Homer don't show: what's wrong with this home, what's happening in this building, and how this street block differs from the suburb.
• I couldn't identify the founder with 52–54k downloads. Ask the organisers on the day; tailoring the pitch to his extension is worth it.
What buyers already see vs. the gaps
Show only what the listing page doesn't. Anything the portal already shows is noise, and the report must prove "added value". The portal column is from my general knowledge of REA and Domain, so check it by opening three listings on each before you write report.html.
Fact
On the REA / Domain listing?
In the Microburbs API?
In the panel?
Asking price or guide
Often; sometimes withheld
No, and you can't read it off the page
No. Homer's turf
Beds, baths, parking, photos
Yes
Yes (basics/all)
Only to filter comparables
Past sales of this home
Usually, in property history
Yes (sale-history)
Yes, reframed: what the vendor paid, when, and any withdrawn listing
Estimated value
Not on the listing page
Yes: value, 80% range, confidence
Yes, range shown honestly
Rent this home last achieved
Rarely on a for-sale listing
Yes (rent-history)
Yes
Suburb median, demographics
Yes
Yes
Only as the baseline for the block comparison
Nearby schools
Yes
Yes, with NAPLAN rank
Low priority
Flood, heritage, HV lines, contamination, mobile black spot
No
Yes, with an on_property flag
Yes. Core
Crime
No
Yes, down to the street block
Yes, block vs. suburb
Social housing share
No
Yes: overlay plus a per-home flags file
Yes, worded carefully
Other units for sale in the same building
No; you'd have to search
Yes: suburb listings feed, filtered to the building
Yes. Core
What units in this building sold for
Only via a separate sold search
Yes: suburb recent sales, filtered
Yes. Core
Rental vacancy and yield by block
No
Yes
Investor view only
Zoning and height limits
No
Yes
Houses only; low priority here
The API also returns 403 for addresses outside the 29 suburbs, and HTTP 200 with data: null when it has no figure. The panel needs a calm empty state for both.
The product: Microscope
"The listing is the seller's pitch. Microscope is your second opinion." One panel, one verdict line, four cards, each answering a question a buyer has and the listing won't answer. Name alternatives: Fine Print, Second Look.
Who it's for: buyers browsing inner-Sydney apartments (owner-occupiers first, investors second), and the partner — a property extension that wants Microburbs facts and branding inside it.
The flow
1. The buyer opens a listing on REA or Domain.
2. The panel shows "Matched: Unit 105, 8 Sam Sing Street, Waterloo" with a Not this one? picker of the other candidates and a type-it box.
3. A verdict line sums up the cards in one sentence, e.g. "Valued $740k–$880k · 3 other units in this building for sale · no hazards on the property" (illustrative numbers).
4. Four cards, below. An optional box lets the buyer type the guide or their offer, since the panel can't read the price.
Card 1 — What it's worth
• Microburbs value, 80% range and confidence score (valuation/all).
• What the vendor paid and when, with the implied change (history/all).
• Typed guide or offer → a marker on the value range: below, inside or above it.
• The three closest comparable sales: beds, price, date (comparables/all).
Card 2 — What the listing doesn't say
• Only hazards where on_property is true: flood, past flooding, heritage, high-voltage line, landslide, contamination, mobile black spot (risks/all). The API's own docs warn that a returned row means "found nearby", not "on this property". Showing "Nothing on this property" is a valuable answer too.
• Listed before? A For Sale record with no sale after it means it was listed and pulled (sale-history).
• Last rent achieved and when (rent-history).
Card 3 — Your building (houses get Your street block instead)
• Homes in the building: every address sharing the street number, street and suburb in the supplied address list.
• For sale right now in this building, and similar homes within about 500 m (suburb listings/for-sale, filtered).
• Sold in this building in the last two years, by bedroom count (suburb sales/recent, filtered).
• Estimated social housing share in the building (the supplied flags file, joined on the address ID).
• This block vs. the suburb: predicted crime per 100,000 residents for the street block against the suburb average (crime/by-mesh-block vs. crime/summary).
Card 4 — Questions to ask the agent
Up to three questions, each triggered by a fact on the panel, with a copy button. Examples:
• "Four other units in this building are for sale. Is there a strata issue, special levy or defect claim?"
• "The property sits on a flood overlay. Has the building had water come in, and what does insurance cost?"
• "It was listed in March with no sale recorded. Why was it withdrawn?"
Rule-based is enough; it needs no AI and can't hallucinate. This card is what turns data into action, and it's the moment to land in the pitch.
Built to drop in. Ship the panel as a page your proxy serves, so the founder's extension could embed it in an iframe with "Powered by Microburbs". That's the line that speaks to Microburbs' business: their API inside an extension with about 50,000 downloads.
Stretch, only if time allows: a Live in / Invest toggle that moves rent, yield and vacancy to the top for investors.
The clever step and the held-out check
The clever step is unit-level matching plus building grouping, and the held-out check is a measured match rate on listings you didn't tune on. Both go in report.html, and both answer the judges' own test.
1. Unit-level matching against the supplied address list
1. Read the address heading only.
2. Normalise it: "105/8" → unit 105 at number 8; "Apt", "Unit", "Level 1," handled; "St" ↔ "Street"; ranges like "8–10" tried as 8, 10 and the range.
3. Look it up in an index built from the 11:00 address file, keyed on unit, number, street and suburb.
4. No exact hit → call /v1/geocode/address, score its up-to-10 candidates against the parsed parts, and pick only above a threshold.
5. Building found but not the unit → say so and show the units to pick from. A wrong match is worse than no match, so the panel asks rather than guesses.
2. Building grouping. Every address sharing number, street and suburb is one building. That single key lets you filter the suburb's for-sale and recent-sales feeds to "this building" and join the social-housing flags file to get a building share. No existing extension does this.
3. Reading the data correctly. Show hazards only where on_property is true; show the value as a range with its confidence, not a single number; treat data: null as "no figure", not zero. Data-science judges notice this.
The held-out check
• Before writing the matcher, collect 30–40 real listings in the 29 suburbs, from both REA and Domain: houses, units, "Level" units, number ranges, and one "address on request". Record the URL and the address as shown, nothing else.
• Set 10 aside and don't look at them until the matcher is frozen.
• Score the 10: exact home, building only, no match (panel asked), wrong match. Report all four honestly, including the misses.
• Spot-check five panels: call the same address ID in the API docs' Test Request and confirm the panel shows the same figures.
• Optional, if time allows: for buildings with recent sales, report how far the Microburbs value sits from those sale prices.
Build plan
The build is a thin extension, a small proxy that holds the key and the address index, and about ten API calls per listing. You have four hours, so the feature freeze is at 1:45 pm and the last 50 minutes go to videos and the report.
Only the address leaves the listing page; the key, the address list and the flags file stay on the proxy.
API calls per listing (all through the proxy, cached)
Step
Endpoint(s)
Notes
Match
/v1/geocode/address
Only when the address-list index misses
Card 1
valuation/all, history/all, comparables/all
History is shared with card 2
Card 2
risks/all
Filter to on_property
Card 3
suburb listings/for-sale, sales/recent, crime/summary, crime/by-mesh-block; property profile
Suburb feeds fetched once per suburb; profile gives the mesh block
Filters
basics/all
Bedroom count for "similar" homes
That's about ten calls for the first listing in a suburb and about six after, well inside the limit of roughly 10 a second.
Roles for a team of three or four
• Extension and panel UI: manifest, address reading, page-change handling, the four cards.
• Proxy and matcher: deploy the proxy, load the address list at 11:00, the normaliser and the candidate picker.
• Data logic: card calculations, building filters, the question rules, the verdict line.
• Evidence and story: the 30–40 test listings, the held-out score, report.html, pitch and demo videos. Two people can split this if you're a team of three.
Tonight (prep only)
[ ] Ask the organisers whether boilerplate written before 11:00 is allowed. The guide frames the build as 11 to 3.
[ ] Build a throwaway "hello world" side-panel extension to learn Load unpacked.
[ ] Clone the demo repo and get the Next.js proxy deploying to Vercel, keyless.
[ ] Collect the 30–40 test listing URLs in the 29 suburbs.
[ ] Draft the pitch script below and agree roles.
Saturday
Nothing new gets built after 1:45; the rest of the time proves it works and tells the story.
Pitch, demo and report
The 45-second pitch decides whether you reach the room, so it leads with the buyer's problem, shows one moment of the panel, and ends on a number you measured. Bracketed figures get filled in on the day.
Pitch script (about 110 words, 45 s)
Every property listing is written by the seller's agent. It'll tell you about the north-facing balcony. It won't tell you that [four] other units in the same building are for sale right now, that it was listed in [March] and pulled, or that it sits on a flood overlay.
Microscope opens beside any realestate.com.au or Domain listing, matches the exact apartment — [9 of 10] unseen test listings to the right unit — and shows four things the listing won't: what it's worth, what it doesn't say, what's happening in the building, and the questions to ask at inspection.
Built on Microburbs data, and built to drop into an extension with 50,000 downloads.
Record it as a screen capture with voiceover, with captions burned in, since an AI watches it first. Put the hook in the first five seconds.
Demo, 3 minutes
Time
Show
0:00–0:15
The problem in one line; what Microscope is
0:15–0:45
Domain apartment listing: matched unit, verdict line, value card, hazards card
0:45–1:30
Your building: units for sale and sold here; the questions card, copied to clipboard
1:30–2:00
REA house listing: street block vs. suburb crime; a clean "nothing on this property"
2:00–2:20
Hard cases: a "Level 3, 105/8" address and the picker; an out-of-area listing's calm state
2:20–2:45
Held-out results; the panel embedded as a drop-in for a partner extension
2:45–3:00
Close on the one-liner
report.html outline (copy the format of the guide's example reports)
1. What buyers already see: the portal comparison table, described in words. Use no listing screenshots, which would copy listing photos.
2. Existing extensions: the competitor table and the gap.
3. Added value and why these facts: per card, the buyer's question → the fact → the endpoint → why it isn't on the portal.
4. Data and method: endpoints, the address list, the flags file, the matcher, building grouping.
5. What worked and what didn't.
6. Held-out check: the four-outcome table and the spot-checks.
7. Credits: Microburbs API, Open G-NAF (© Geoscape Australia), any other source, also in README.md.
Your three ideas: keep, cut or shrink
Keep idea 3 and the heart of idea 2; cut idea 1 for tomorrow. The test for each is whether a judge opening a real listing would see more value, sooner.
Your idea
Verdict
Why
Build instead
1. Save and track across sites in a central portal
Cut (roadmap)
Homer already has a shortlist and compare workspace on web, iOS and Android. Judges won't test it. It's auth and database plumbing, not data. And with no listing text or photos allowed, saved items would be bare addresses
If time is left: a Compare tray in the panel holding up to three matched homes in local storage, Microburbs facts side by side
2. Is it well priced, plus an AI quiz and rearrangeable widgets
Keep the core, cut the machinery
The panel can't read the asking price, so "well priced" needs the buyer to type the guide. A quiz adds a step before any value, and judges score which facts you chose, not layout freedom
The typed guide on the value range (card 1); crime at street-block level and rent are in; a one-tap Live in / Invest toggle replaces the quiz
3. Competitive analysis: what else sold or is for sale nearby
Keep, sharpened
It's the most novel of the three once it's per building
Card 3: for sale and sold in this building, plus similar homes within about 500 m
Other ideas I weighed and set aside
• Hidden price reveal — the brief rules it out, and Homer owns it.
• Rent vs. buy for this exact home — good, but it's the investor view; build it only after the four cards work.
• "What could be built next door" from neighbours' zoning and height limits — strong for houses, weak in an area that's mostly flats. Roadmap.
• A personal match score — needs the quiz; roadmap.
Risks, ethics and things to confirm
The biggest risks are a broken address reader mid-demo and a careless social-housing figure; both have simple fixes.
Risk
Fix
Social-housing share reads as stigma, or exposes individual homes
Show it only at building level, as "estimated share of social housing homes", in neutral colour, never in the verdict line or the questions. The brief says the flags are estimates, not checked owners; say that too
The supplied CSVs leak
Load them from a local path at runtime; .gitignore them with .env
A portal changes its markup and the address reader breaks
Fallback to the type-it box; re-test every demo listing at 2:00
Buildings with two street numbers ("8–10", corners) look like two buildings
Merge ranges in the normaliser; name the limit in the report
"Others for sale in this building" counts the listing itself
Exclude the matched address ID from the feed
Rate limit or slow calls during the demo
Cache suburb feeds; warm the cache on every demo listing before recording
A figure reads as advice
Footer: "Estimates, not a valuation or financial advice", plus an as-of date on each card
Confirm with the organisers on Saturday
[ ] Is boilerplate written before 11:00 allowed?
[ ] Who is the founder with 52–54k downloads, and which extension is his?
[ ] Does listings/for-sale cover everything on the portals, or a sample?
[ ] Do sale-history For Sale rows reliably show withdrawn campaigns?
Sources
• Microburbs: Chrome extension task · Hackathon guide · Getting started · API spec · Demo apps repo (endpoint list taken from its code)
• Australian extensions: Homer and homerapp.com.au · Property Seeker · PriceDaddy! · Property Buddy · Real Price · Properly · TruePrice · READevil · Tell 'em They're Dreaming
• Overseas: Area360 · The Negotiator on Property Log
User counts and ratings are as shown on each store page on 6 November 2026.