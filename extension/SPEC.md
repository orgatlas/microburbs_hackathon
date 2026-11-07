# Extension spec (Hrithik)

The extension reads the address from a listing, asks the backend for a match, and shows the score beside the listing. It's plain Manifest V3 JavaScript with no build step, so changes only need a reload in `chrome://extensions`.

## What's already here

| File | Purpose |
| --- | --- |
| [`src/address.js`](src/address.js) | Finds the address. Selectors **haven't been tested on live sites** |
| [`src/content.js`](src/content.js) | Watches for listing changes and sends the address |
| [`src/background.js`](src/background.js) | Calls the API, stores each tab's result, sets the badge |
| [`sidepanel/`](sidepanel/) | Bare panel with all states and a typed address box |
| [`onboarding/`](onboarding/) | Bare one-page quiz, opened on install |
| [`src/config.js`](src/config.js) | API base URL |

Run the backend, load `extension/` unpacked, and open any listing. Mock mode returns the same synthetic home for every address, so don't treat that as a working match. The side panel has not been run in Chrome yet, so test the flow first.

## Rules from the brief

- **Read only the address, or ask the user to type it.** Never read or send price, description, photos or agent details.
- **Never put the Microburbs key in the extension.** All data goes through our backend.

## Build order

1. **Prove the flow** in Chrome with mock data: install, quiz, listing, badge, panel.
2. **Fix address reading** on real listings on both sites. Check houses, units, and pages that hide the address, such as "Address available on request". Those pages should fall back to the typed address box.
3. **Handle navigation.** Moving between listings must never show the previous home's score. Search result pages should show the empty state.
4. **Build the real quiz** as one question per screen, rendered from `GET /api/quiz`. Let users retake it from the panel.
5. **Design the panel:** score first, matched address always visible, each pillar expands to its factors. Show `dealbreakers` and `data_gaps` clearly.
6. **Point at production:** update `src/config.js` and add the host to `host_permissions`.

## States the panel must handle

Test these with the mock addresses in [the contract](../docs/API_CONTRACT.md#testing-the-states-in-mock-mode).

| State | What the user sees |
| --- | --- |
| No listing | Prompt to open a listing |
| Loading | The address being checked |
| `matched` | Score, matched address, pillars |
| `ambiguous` | "Which home is this?" with the candidates |
| `no_match` | Message and the typed address box |
| `out_of_area` | City of Sydney only message |
| `error` | Friendly message and retry |
| No profile saved | Generic score and a prompt to take the quiz |

Most Sydney listings are outside our data area, so demo with listings in the [29 covered suburbs](https://api-ht.microburbs.com.au/docs), such as Surry Hills, Glebe, Pyrmont and Redfern.

## Done means

- [ ] A fresh install gets from quiz to score on a real listing with no console errors
- [ ] Works on both realestate.com.au and domain.com.au
- [ ] Switching tabs or listings always shows the right home
- [ ] The matched address is always visible, and typing a correction works
- [ ] Network requests contain only the address and quiz profile
