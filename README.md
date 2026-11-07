# MicroMatch

**Team Microscope · Microburbs Hackathon 2026 · Task 3**

MicroMatch is a Chrome side panel that shows how well a property fits your priorities while you browse Domain or realestate.com.au. A short quiz on the companion website personalises the score for renters and buyers across the City of Sydney’s 29 suburbs.

[Hackathon report](report.html) · [Product demo](demo.mp4) · [Team pitch](pitch.mp4) · [Run locally](#run-it)

## What we built

- **Onboarding website.** Create an account, take the quiz and revisit it when your budget or priorities change. Your saved profile is shared with the extension.
- **Property side panel.** See an animated 0–100 fit gauge, ranked pros and cons marked with plus and minus signs, and four expandable bars for Commute, Safety, Lifestyle and Price.
- **Address matching.** The extension reads the listing address only. Check the matched address in the panel, choose another candidate when available, or enter an address yourself.

## Who it helps

- **Renters** can see how estimated weekly rent compares with their income and weigh it against transport and everyday amenities.
- **Buyers** can see how an estimated value compares with their budget and nearby sales, alongside running-cost signals where the API has data.
- **Households with different routines** can see which homes fit their own priorities, whether that means getting to work, living near a park or finding parking.

## The data

The local proxy matches addresses to Open G-NAF IDs and fetches property and suburb facts from the Microburbs API. The API key stays in the proxy.

| Pillar | Signals used when available |
| --- | --- |
| Commute | Nearby public transport, straight-line distance to work and Town Hall, parking and busy-road exposure |
| Safety | Local crime and liveability benchmarks, and mapped property hazards |
| Lifestyle | Nearby supermarkets, gyms, cafés, green space and nightlife |
| Price | Advertised rent history, area rent estimates, modelled value, comparable sales, running costs and development activity |

Rent uses the latest usable advertised figure, with a labelled mesh-block or suburb estimate as a fallback. Commute distances are approximate. Market estimates are indicative.

**Data credits.** Microburbs supplies the property and suburb facts. Open G-NAF address identifiers are © Geoscape Australia and licensed by the Commonwealth of Australia under the Open G-NAF End User Licence Agreement. ABS Census and mesh-block geography are © Commonwealth of Australia under CC BY 4.0. The optional hackathon-supplied City of Sydney address and estimated public-housing files stay in the ignored `data/` directory. The panel excludes public-housing estimates from the fit score.

## The clever step

**Match the home, then match the person.** The proxy checks the unit, street number, street and suburb before labelling a result as an exact match, a building match or a guess. The fit score needs an exact match and a saved quiz profile.

The quiz sets weights for all four pillars and for individual signals. The scorer combines the available signals with those weights and redistributes weight when data is missing. The panel shows which facts drove the score and how many signals it could use.

In the recorded demo, an archived Domain page for 59 Portman Street in Zetland was matched exactly and the property facts came from the live API. The same home scored **42/100 for Sarah’s rental profile** and **65/100 for Alex’s buyer profile**.

Open `report.html` in a browser for the interactive walkthrough and the recorded checks.

## Run it

**Requirements.** Node.js 20.12+ with npm, Python 3.12+ with `venv`, Bash, `lsof`, `pgrep`, Chrome and a valid Microburbs hackathon API key. On Windows, run the shell commands in WSL and load the extension in Chrome on Windows.

1. Clone the repository and copy the API key template.

   ```bash
   git clone https://github.com/orgatlas/microburbs_hackathon.git
   cd microburbs_hackathon
   cp proxy/.env.example proxy/.env
   ```

   Set `MICROBURBS_API_KEY` in `proxy/.env`. This file is gitignored. Keep the key there.

2. Free ports **3000**, **3001** and **8001**, then start the local stack from the repo root.

   ```bash
   bash run.sh
   ```

   The script installs dependencies on first run and runs database migrations. It starts the API proxy on port 3000, the Next.js website on port 3001 and the Django account service on port 8001. Press **Ctrl+C** to stop the stack.

3. In Chrome, open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the repo’s `extension/` folder.
4. Open the local website, create an account, complete the quiz and leave the dashboard open until your profile syncs. [Open MicroMatch](http://localhost:3001)
5. Open a City of Sydney listing on Domain or realestate.com.au and click **MicroMatch** in the Chrome toolbar. If the listing address does not appear, use the address field in the panel.

## Verify

Run the address extraction, scoring and side panel tests from the repo root. The proxy test command also runs the integration tests against a local test server.

```bash
node --test extension/address.test.js extension/sidepanel/score.test.js extension/sidepanel/fit.test.js
npm --prefix proxy test
```

[Scoring notes](docs/SCORING.md) · [Proxy API contract](docs/API_CONTRACT.md) · [Fresh-clone audit](tests/HANDIN-CHECK.md)
