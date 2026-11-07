# Backend spec (Carl)

The backend keeps the Microburbs key private, matches addresses to homes, and turns facts into a match score. It implements [the API contract](../docs/API_CONTRACT.md).

## What's already here

- `/api/health`, `/api/quiz` and `/api/match` work in mock mode, so Hrithik and Daniel aren't blocked.
- [`matching/microburbs.py`](matching/microburbs.py) is the API client, with auth, caching and 429 retries. It hasn't been run against the live API yet.
- [`matching/scoring.py`](matching/scoring.py) is an empty stub.

## Setup

Put the team key in `backend/.env` as `MICROBURBS_API_KEY`. Set `MATCH_MOCK=False` when real matching is ready. Run the tests with `.venv/bin/python manage.py test`.

API docs are at https://api-ht.microburbs.com.au/docs and the full spec is at `/openapi.json`.

## Build order

1. **Resolve the address.** This is the main challenge in the brief, so do it first.
2. **Fetch the facts** for one home.
3. **Score them**, and return the contract shape.
4. **Harden it** against real listings.

## 1. Resolve the address

Call `GET /v1/geocode/address?address=...`, which returns up to 10 candidates, best first.

- **Don't just take the first candidate.** Judges check that the facts belong to that exact home. Compare the street number, street and suburb, plus the unit number when there is one.
- **Normalise before comparing:** `Unit 5, 26 Tudor St` and `5/26 Tudor Street` are the same home, and `St` means `Street`.
- **Return `ambiguous`** if the listing gives no unit number but the candidates are units, or if no candidate is clearly the best.
- **Return `out_of_area`** on a 403. Geocoding is nationwide but data calls aren't, so also expect this after a successful geocode.
- **Test early:** we haven't yet seen how geocode treats units, so try some real unit addresses first.

Once you have a `gnaf_id`, call `/v1/properties/{gnaf_id}/profile`. Its `suburb` value is the exact name for `/v1/suburbs/{suburb_name}/...` routes. Some have a suffix, such as `Glebe (NSW)`, so don't derive it from the address text.

## 2. Fetch the facts

Run the calls in a small thread pool of about 5. The limit is about 10 requests per second **for the whole team's key**, and the client already caches. Check `data` for `None`: "no data" comes back as HTTP 200, and should go in `data_gaps`, not raise an error.

| Pillar | Endpoint | Use |
| --- | --- | --- |
| Header | `/v1/properties/{id}/basics/all` | Beds, baths, parking, type, land |
| Price | `/v1/properties/{id}/valuation/avm` | Value and range vs budget |
| Price | `/v1/suburbs/{s}/market/all` | Median price, growth, yield |
| Price | `/v1/suburbs/{s}/forecast/sale` | Forecast growth |
| Lifestyle | `/v1/properties/{id}/transport/nearby` | Distance to each transport mode |
| Lifestyle | `/v1/properties/{id}/amenities/nearby` | Supermarkets, green space, restaurants |
| Lifestyle | `/v1/properties/{id}/schools/nearby` | Schools, for families |
| Lifestyle | `/v1/suburbs/{s}/lifestyle/livability` | Scores and regional benchmark |
| Lifestyle | `/v1/suburbs/{s}/demographics/age` | Share of people in the buyer's life stage |
| Safety | `/v1/suburbs/{s}/crime/summary` | Crime vs national median |
| Safety | `/v1/suburbs/{s}/crime/by-mesh-block` | Crime on this block, using `mesh_block` from the profile |
| Safety | `/v1/properties/{id}/risks/all` | Flood, bushfire, landslide and other overlays |

Check real responses before you rely on field names. The examples in the docs aren't always complete. For example, the AVM description mentions a confidence score that its example doesn't show.

## 3. Score

Keep `scoring.py` free of HTTP calls so it can be tested with plain dictionaries.

- **Factor score:** each factor gets 0 to 100 based on the profile. For example, a train at 400 m scores high for someone who selected train, and isn't counted for someone who only drives.
- **Pillar score:** the average of its factors. Skip missing factors rather than counting them as 0.
- **Overall score:** pillar scores multiplied by the normalised quiz weights.
- **Dealbreakers:** cap `overall` at 49 if the low end of the AVM range is above budget, or if the home has fewer bedrooms than the minimum.
- **Labels:** 80+ is `Strong match`, 60 to 79 is `Good match`, 40 to 59 is `Mixed match`, and under 40 is `Weak match`.
- **Explain every factor:** `detail` should be a plain sentence that a buyer understands, and `source` should name the endpoint.

**Price uses the AVM, not the asking price.** The brief lets us read only the address from a listing, so we can't read the price.

**Don't score on who lives nearby.** Leave ethnicity, ancestry, voting, `underclass-drag` and public housing out of the score. Steering buyers by these is ethically and legally risky, and the public-housing flags are estimates. Age and household data are fine for life-stage fit.

## 4. Deployment

The extension needs a public backend for judges. This project already fits the shared Ansible layer:

- WSGI path: `config.wsgi:application`
- No Celery. SQLite is fine because nothing is stored per user.
- All routes must stay under `/api` or `/admin`.

## Done means

- [ ] Five real City of Sydney listings return the right home, including at least two units
- [ ] Every status in the contract can be reached
- [ ] A missing fact shows in `data_gaps` and doesn't crash the response
- [ ] A cached match returns in under 1 second
- [ ] `scoring.py` has tests
