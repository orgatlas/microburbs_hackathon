# Website and marketing spec (Daniel)

The website explains MicroMatch and gets people to install it. It also gives judges a way to try the product without the extension. The videos are scored deliverables, so they come before website polish.

## Priorities

1. `pitch.mp4`: an AI pass uses this to pick the top 25 teams
2. `demo.mp4`
3. `report.html`: **no one owns this yet**, so agree on an owner now
4. Landing page
5. `/try` page

## Website

Next.js 16 with TypeScript and Tailwind. Read `frontend/AGENTS.md` first, because this Next.js version differs from older ones.

| Route | Purpose |
| --- | --- |
| `/` | Landing page |
| `/try` | Short quiz and typed address, with the same score breakdown as the extension |
| `/privacy` | Short page: we read only the address, and there are no accounts |

### Landing page sections

1. **Hero:** the promise, an extension screenshot, and an install button
2. **The problem:** listings show the house, not whether it suits your life
3. **How it works:** take the quiz, browse as usual, see your match
4. **The three pillars:** Lifestyle & Community, Price, Safety
5. **Example breakdown:** one score opened up, using real output on screen but not saved in the repo
6. **Install steps:** the extension won't be in the Chrome Web Store, so explain Load unpacked

### Technical rules

- Call Django from the browser using `NEXT_PUBLIC_API_BASE_URL` and [`src/lib/api.ts`](src/lib/api.ts). Types there follow [the contract](../docs/API_CONTRACT.md).
- No Microburbs key here. Hosting isn't decided yet.
- Don't show realestate.com.au or Domain branding as if they endorse us. Blur or crop listing photos in marketing images.

## Pitch video: 45 seconds at most

| Time | Beat |
| --- | --- |
| 0 to 8s | The problem: a listing can't tell you if a home fits your life |
| 8 to 16s | The idea: MicroMatch scores each home against you |
| 16 to 34s | Screen recording: quiz, real listing, score, breakdown |
| 34 to 45s | The clever step, then name and call to action |

## Demo video: 3 minutes at most

Record this after the 14:00 feature freeze. Show real listings on both sites, with the matched address visible each time. Include a unit, a typed address, and two different quiz profiles getting different scores for the same home, because that's what sets us apart from a plain facts panel.

## Report

[`report.html`](../report.html) is at the repo root, with the required sections as a starter. It needs a comparison of existing extensions and property sites, plus a held-out check.

## Done means

- [ ] Both videos are in the repo root, each under 95 MB and within its time limit
- [ ] `report.html` is complete
- [ ] The landing page works on mobile and is deployed
- [ ] The README has all required sections and data credits
