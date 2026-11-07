# Fit scoring — the current side panel

7 November 2026 · Two-minute overview and threshold table; parsing details below.

Fit is a weighted summary of available facts, not a valuation or a validated prediction. The panel recalculates its own score; backend scores do not enter the arithmetic.

## How the needle is calculated

1. Each dimension is the rounded average of its scored signals. Each signal counts once, except parking and nightlife: their profile flag gives full weight when true, half when absent, and zero when false. Missing or unreadable signals are excluded.
2. Fit is the rounded sum of dimension score × profile weight, divided by the sum of weights for scored dimensions. Empty dimensions are excluded and the remaining weights expand proportionally. No positively weighted evidence means “Not scored”, not zero. For example, only Commute 100 and Price 0 with Sarah’s weights gives round(35 ÷ 60 × 100) = 58.
3. Sarah’s default is Commute 35%, Safety 25%, Lifestyle 15%, Price 25%. Valid weights are scaled to total 100%; unusable weights in an otherwise recognised profile become 25% each. Missing or unrecognisable profiles use Sarah.
4. The three-pillar quiz conversion fixes Commute at 25% and shares the remaining 75% between Safety, Lifestyle and Price in the quiz’s proportions; it selects buy mode and maps the purchase budget. Car selection controls parking; buzzing / quiet controls nightlife. The four displayed tracks are read-only meters. Editing the saved profile through onboarding triggers recalculation.

## Every signal and threshold

Bands below include their written endpoints. Only transport, work and CBD distances taper: after the 50-point plateau, score falls in a straight line to zero at 1,200 m, 10 km and 8 km respectively, rounded to the nearest integer. All other rows use steps.

| Dimension | Signal | 100 | 50 | 0 | Source |
| --- | --- | --- | --- | --- | --- |
| Commute | Nearest transport | <400 m | 400–900 m | ≥1,200 m | T |
| Commute | Work distance | <2 km | 2–6 km | ≥10 km | B |
| Commute | CBD distance | <2 km | 2–5 km | ≥8 km | B |
| Commute | Parking | ≥1 space | — | 0 spaces | P |
| Commute | Busy road | None / >200 m | Nearby / >25–200 m | Fronting / ≤25 m | B |
| Safety | Crime vs supplied benchmark | ≤−20% | >−20% and <+20% | ≥+20% | C |
| Safety | Livability | Above | At | Below | B |
| Safety | Hazards | None | Nearby only | On property | H |
| Safety | Social-housing estimate (unconnected) | Low | Mid | High | None |
| Lifestyle | Supermarket, gym, café within 800 m | 3 categories | 2 | 0–1 | A |
| Lifestyle | Nightlife venue count | ≥3 | 1–2 | 0 | B |
| Lifestyle | Nearest green-space distance | <500 m | 500–1,000 m | >1,000 m | B |
| Price | Rent ÷ weekly income (rent mode) | ≤30% | >30–40% | >40% | R |
| Price | AVM ÷ purchase budget (buy mode) | ≤100% | >100–110% | >110% | V |
| Price | Value vs comparable sales | ≤0% above | >0–5% above | >5% above | B |
| Price | Running costs vs benchmark | Below | At | Above | B |
| Price | Development activity | Low / 0 DAs | Some / 1–4 DAs | Heavy / ≥5 DAs | B |
| Price | Negotiating room | High: vacancy ≥3% or ≥60 days | Mid: vacancy 1.5–<3% or 30–59 days | Tight: vacancy <1.5% or <30 days | B |

## Source endpoints

The panel makes no Microburbs calls itself. Sources come from each returned factor’s source field (or “backend” if omitted). B means that supplied endpoint, with no fixed route assigned in the side-panel code. P is the parking fallback; T/A/C/H/V are endpoint examples in the adapter test fixture, and R is its rent test input—not proof of live coverage. Property paths use /v1/properties/{gnaf_id}/; suburb paths use /v1/suburbs/{suburb_name}/.

- **P:** Property basics/all; property.parking_count takes precedence.
- **T:** Property transport/nearby.
- **A:** Property amenities/nearby.
- **C:** Suburb crime/summary; the benchmark can be national, not necessarily the suburb.
- **H:** Property risks/all.
- **R:** Property rent-history-latest.
- **V:** Property valuation/avm.
- **None:** Social housing is explicitly rejected by the adapter and never enters the panel score; low/mid/high are reserved scorer bands.

## Which reasons appear?

A signal’s share is its dimension’s effective weight × its share of that dimension’s signal weights. Halos (score ≥70) rank by score × share; failos (score ≤30) by (100 − score) × share. Keep at most three of each with positive contribution. Ties prefer the higher halo score or lower failo score, then signal order. Overall bands are Failo 0–30, Meh 31–69, Halo 70–100. Missing source dates are labelled missing; a fetch date is not the data’s as-of date.

## Parsing details — reference

- The adapter uses 80 m per walking minute. Daily needs count categories within 800 m, not venues; unreported categories remain unknown, and the signal is scored only if those unknowns cannot change its band. Nightlife accepts a count, or one nearest venue within 800 m / ten minutes as one; multiple explicit counts are added.
- Road-distance bands and DA-count bands apply when parsing distance or count text. Structured development numbers are already levels 0/1/2, not DA counts. Vacancy-percentage text and days-on-market text use the table’s bands; other structured negotiating numbers are levels. Livability and running-cost percentage comparisons treat ±5% as “at”; direct coded levels use their sign.
- Nearest distance wins when several factors map to one distance signal; worst road/hazard level wins. Otherwise the first readable factor is used, except daily-needs aggregation and nightlife counts. Hazard flags, coded levels and explicit wording can establish “on property”; proximity alone cannot.
- Rent must be positive and weekly income positive; buy mode needs positive AVM and budget. Weekly rent is converted from monthly, quarterly or yearly amounts when labelled. The other mode’s price fact is excluded. budgetWeekly does not affect rental affordability. The adapter can use the midpoint of a textual AVM range.
- The panel consumes supplied work/CBD distances and the supplied comparable-sales percentage: it does not geocode work, calculate haversine distance, select three comparables or independently check data freshness. Counts are rounded and clamped non-negative; level codes are rounded/clamped to 0–2, except signed livability/cost levels.

Implementation: [score.js](../extension/sidepanel/score.js), [adapter.js](../extension/sidepanel/adapter.js), [profile.js](../extension/sidepanel/profile.js), [sliders.js](../extension/sidepanel/sliders.js), [halos.js](../extension/sidepanel/halos.js) and [panel.js](../extension/sidepanel/panel.js). Starting model: [README scoring table](../README.md#scoring-model-the-panels-scorejs-documented-in-docsscoringmd). Endpoint examples: [existing tests](../extension/sidepanel/score.test.js).
