# Fit — pitch scripts and demo storyboard

7 November 2026 · Microburbs Hackathon · City of Sydney

**Use version 1.** It gives Sarah a concrete problem, makes the moving needle the reveal, and finishes on a number we can substantiate.

**Listing assumption:** the request contained “[paste teammate’s six]” rather than URLs. This storyboard uses the six already recorded in [`tests/e2e/listings.json`](../tests/e2e/listings.json), reproduced below.

**Evidence behind every closing line:** [`tests/findings.md`](../tests/findings.md), run at 12:17:52 Sydney time on 7 November 2026, records correct address extraction on **6/6 archived listing replays**, three per portal. The proxy was in mock mode and returned the same Surry Hills fixture for all six queries. This is an address-extraction result, **not six correct property matches, live-site reliability, or held-out accuracy**. The scripts use that measured number without upgrading the claim. The run used an earlier panel build; it does not validate the current four-dimension panel. No new run was performed for this document.

## 45-second pitch — version 1: “Can Sarah live here?”

Read the quoted text only, at roughly 145 words per minute. Give the needle moment a two-second pause; finish by 00:45.

> Sarah is nineteen, earns six hundred dollars a week in casual retail, and needs to move out. A beautiful listing doesn’t answer her question: can I afford to live here and get to work?
>
> Fit puts Microburbs facts beside the listing: Commute, Safety, Lifestyle and Price. Six questions set her priorities.
>
> Watch the needle. Give affordability more weight, and her fit score changes. Same home. Same facts. Different priorities.
>
> Underneath are the reasons, each with a number and source. The matched address stays visible, so Sarah can check we’re judging the right home.
>
> Our archived replay check extracted the correct listing address on six out of six.

| Time | Picture / action |
| --- | --- |
| 00:00–00:09 | Sarah title card: “19 · casual retail · $600/week”. Move straight to the Fit panel on listing R1. |
| 00:09–00:18 | Show her quiz-derived profile and the four dimensions. Keep the matched-address header in view. |
| 00:18–00:27 | On the same loaded home, raise Price’s weight. Hold the actual before-and-after needle positions. Do not change the facts, budget or income during this shot. |
| 00:27–00:36 | Point to one available halo, one failo and their sources. Show fewer if fewer qualify. |
| 00:36–00:45 | Evidence card: **“Correct address extraction · 6/6 archived listing replays”**. Subline: “Mock proxy · earlier build · not a live or held-out match result”. |

## 45-second pitch — version 2: “The score belongs to Sarah”

> Sarah is nineteen. She earns six hundred dollars a week and needs a home that gets her to work without swallowing her pay. A home’s score should reflect her life.
>
> Fit asks six questions, then weights Commute, Safety, Lifestyle and Price around the answers, using Microburbs facts beside REA and Domain listings.
>
> Here’s the moment: Sarah gives Price more weight. Watch the needle move. The property hasn’t changed; what matters to her has.
>
> Halos and failos explain the result with sourced numbers. Missing data stays missing, and the matched address is visible.
>
> In our archived replay check, address extraction was correct on six out of six.

| Time | Picture / action |
| --- | --- |
| 00:00–00:10 | Sarah title card, then profile on listing R1. |
| 00:10–00:20 | Brief quiz view; cut to the saved four weights and Microburbs source labels. |
| 00:20–00:29 | One Price-weight adjustment; hold the changing needle, with the same matched address visible. |
| 00:29–00:36 | Sourced reasons and the address header. Show a missing-data state only if one is actually present. |
| 00:36–00:45 | Same evidence card and qualification as version 1. |

## 45-second pitch — version 3: “A cheap-looking home can still be wrong”

> Sarah is nineteen, on six hundred dollars a week, and moving out. She needs more than a property price. She needs to know whether this home fits her life.
>
> Fit turns Microburbs facts into a personal score beside the listing. Six questions set the weights for Commute, Safety, Lifestyle and Price.
>
> Now Sarah puts more weight on affordability. Watch the needle change, without changing the home. That’s the clever step: the score follows her priorities.
>
> Below it, sourced positives and negatives explain the trade-offs. We show the matched address and leave missing facts unscored.
>
> Our archived replay check extracted the correct address on six out of six.

| Time | Picture / action |
| --- | --- |
| 00:00–00:10 | Sarah card; show her $600 weekly income and $250 weekly budget in Fit. |
| 00:10–00:20 | Listing R1, four dimensions, quiz-derived weights. |
| 00:20–00:29 | One affordability-weight change; hold the needle movement. Do not claim a particular direction or invent a score. |
| 00:29–00:36 | Highlight the displayed address, available reasons and source labels. |
| 00:36–00:45 | Same evidence card and qualification as version 1. |

## The six listings

These are the teammate’s recorded test URLs and rental / sale classifications, not a claim that the advertisements remain active today. The recorded automated run used archived markup because both portals blocked automated Chromium. The URL and address identify the intended home; the panel’s actual match must still be checked.

| ID | Portal / mode | Address | Listing |
| --- | --- | --- | --- |
| R1 | Domain · rent | 17 Young Street, Redfern NSW 2016 | [Open R1](https://www.domain.com.au/17-young-street-redfern-nsw-2016-17875055) |
| R2 | REA · rent | 504/349–355 Bulwara Road, Ultimo NSW 2007 | [Open R2](https://www.realestate.com.au/property-apartment-nsw-ultimo-426000942) |
| R3 | Domain · rent | 59 Portman Street, Zetland NSW 2017 | [Open R3](https://www.domain.com.au/59-portman-street-zetland-nsw-2017-17904853) |
| S1 | REA · buy | 8/342 Bourke Street, Surry Hills NSW 2010 | [Open S1](https://www.realestate.com.au/property-apartment-nsw-surry+hills-147399572) |
| S2 | REA · buy | 801/8 Darling Island Road, Pyrmont NSW 2009 | [Open S2](https://www.realestate.com.au/property-apartment-nsw-pyrmont-143367376) |
| S3 | Domain · buy | 110/11 Wigram Lane, Glebe NSW 2037 | [Open S3](https://www.domain.com.au/110-11-wigram-lane-glebe-nsw-2037-2020659759) |

## Three-minute demo storyboard

**Recording treatment:** show the Fit panel and the listing’s address / URL context. Frame or mask out listing photos and description text. Use your own title and evidence cards. Keep sources, dates, match warnings and any “Mock data” badge readable. Do not use archived listing screenshots as B-roll.

**Profiles:** rentals use the README’s Sarah preset: rent, $250/week budget, $600/week income, work at Broadway, Ultimo; weights 35% Commute, 25% Safety, 15% Lifestyle, 25% Price. For S1–S3, deliberately switch to a separate **“Buyer demonstration”** profile in buy mode with a $1.2 million purchase budget. This is a demo input, not Sarah’s finances or a property price. Rent / buy mode comes from the profile, not the listing’s extracted content.

The narration below is ready to read. Directions describe what to capture, not results already observed. Rehearse once and keep the final video at or below 03:00.

| Time | Screen and action | Spoken narration |
| --- | --- | --- |
| 00:00–00:12 | Sarah card, then R1 in Domain with Fit open. Show the actual match status. | “Sarah is nineteen, earns six hundred dollars a week in casual retail, and needs to move out. Fit helps her weigh a home against her own priorities.” |
| 00:12–00:28 | R1: show the six-question onboarding flow briefly, then Sarah’s saved preset and four weights. | “Six questions turn her answers into weights for Commute, Safety, Lifestyle and Price. This is Sarah’s starting profile: two hundred and fifty dollars a week, with work in Ultimo.” |
| 00:28–00:43 | R1: point to extracted address, matched address, one available reason and its source / date. If the match is wrong or uncertain, use the replacement line below. | “First, check the home. The address we read and the address we matched must agree. The facts come from Microburbs. Each displayed reason carries its number and source.” |
| 00:43–01:00 | R1: capture the needle before changing Price’s weight. Make one clear adjustment; hold the actual resulting score. Keep the address and underlying facts fixed. | “Now give affordability more weight. Watch the needle move. The home and facts stay the same; their importance changes. That is personal fit, and the reasons underneath let Sarah inspect it.” |
| 01:00–01:16 | R2, REA: focus on unit 504 and street-number range 349–355 in the query and returned match. Show actual confidence or correction controls. | “On REA, this address has both a unit number and a street-number range. Unit five-oh-four at three-forty-nine to three-fifty-five must not silently become another apartment.” |
| 01:16–01:31 | R3, Domain: show actual available dimensions and their sources. If a signal is missing, show its empty state; otherwise retain the real populated view. | “At Portman Street, check the available evidence again. Missing facts are left unscored, never treated as zero. A score summarises what is available; it doesn’t promise complete coverage.” |
| 01:31–01:47 | S1, REA: switch to “Buyer demonstration”, buy mode, $1.2m budget. Show the matched unit and available Price evidence. | “Now a separate buyer demonstration, with a one-point-two-million-dollar budget. Buying compares Microburbs’ estimated value with that budget. We read only the listing address, not the advertised asking price.” |
| 01:47–02:02 | S2, REA: show unit 801 at 8 Darling Island Road, actual match status, then one available sourced factor. | “At Darling Island Road, the same identity check matters: unit eight-oh-one, street number eight. A useful-looking number is no help if it belongs to the wrong home.” |
| 02:02–02:17 | S3, Domain: focus on unit 110 at 11 Wigram Lane. Open “Not this one?” or the typed-address control without implying the first match was wrong. | “At Wigram Lane, check unit one-ten at number eleven. If the match is uncertain, the candidate picker or typed address gives the user a way to correct it.” |
| 02:17–02:33 | Stay on S3. Show one real source label, as-of date and estimates footer. Add a small “City of Sydney trial only” caption. | “Coverage is the City of Sydney trial area. Sources and dates stay visible. These are indicative estimates, not a valuation or financial advice. We never turn unavailable data into certainty.” |
| 02:33–02:48 | Evidence card: “Address extraction: 6/6 archived replays”. Below: “3 REA + 3 Domain · mock proxy · earlier build · not held-out matching”. | “Our recorded check extracted the correct address from six archived listings: three on each portal. It used a mock proxy and an earlier build, so this is not a live address-match rate.” |
| 02:48–03:00 | Return to Sarah’s profile and the recorded needle moment; finish on the qualified evidence card, without animating a fabricated score. | “The useful step is personal weighting, with reasons you can inspect. The measured result so far: correct address extraction in archived replays, six out of six.” |

### Honest replacement lines for recording

Use the line that matches what is actually on screen; keep it inside that shot’s allotted time.

- **Wrong or ambiguous home:** “This result is not an exact match. We flag that uncertainty and let the user select a candidate or type the address. These facts cannot yet be attributed to this listing.”
- **Portal blocked or listing unavailable:** “This listing could not be loaded here. I’m entering its recorded address manually; this demonstrates the fallback, not automatic extraction from a live page.” Show the corresponding address from the six-listing table in Fit’s existing manual-entry control.
- **Mock facts:** “This is mock data demonstrating the interface, not facts about this advertised home.” Keep the mock label visible and do not describe the fixture as a successful property match.
- **No value or other signal returned:** “Microburbs has no figure for this signal here. It stays unscored.”

### Lock the needle shot before recording

1. At **13:45**, use the recording build to load R1 and confirm its match and data mode. Choose a weight adjustment that actually changes the rounded score; the movement depends on the available dimension scores. Keep income, budget and property facts unchanged during the adjustment.
2. If R1 cannot produce that shot, try R2, then R3. Use the successful rental for the pitch and main needle demonstration, while retaining all six addresses in the demo. Do not manufacture movement or reuse the old mock run’s 60 / 70 values as current Fit results.
3. If only a fixture works, label it “Mock data — interaction demonstration” throughout. The needle shot then demonstrates the interaction only. If no actual movement works, the advertised shot is not ready to record; fix or simplify the interaction first.
4. At **14:15**, review new evidence before replacing the closing number. Keep the complete existing 6/6 archived-extraction line unless a new, documented result supports a stronger claim. The six rehearsed addresses cannot become a held-out sample.

**Definition of done:** one rehearsed pitch under 45 seconds, one demo under three minutes, all six addresses represented, one real captured needle movement with its data mode disclosed, and every spoken measurement traceable to recorded evidence. Export `pitch.mp4` and `demo.mp4`, each under 95 MB, by **14:45**.
