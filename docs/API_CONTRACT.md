# API contract

This is the agreement between the backend, extension and website. Carl owns it. If it needs to change, update this file in the same commit and tell the team.

- Local base URL: `http://localhost:8000/api`
- Production base URL: to be decided
- There are no accounts. The client stores the quiz profile and sends it with each match.
- Routes have no trailing slash.
- There is no mock mode: until real matching lands here, `POST /api/match` answers 501 `not_implemented` and the extension's facts come from the live proxy, `GET http://localhost:3000/lookup?address=...`, which calls the Microburbs API.

## `GET /api/health`

```json
{ "status": "ok" }
```

## `POST /api/match`

Send either `address` or `gnaf_id`. Send `gnaf_id` once the user has picked a candidate. `profile` can be `null`, in which case the backend uses equal weights and skips personal checks such as budget.

```json
{
  "address": "26 Tudor Street, Surry Hills NSW 2010",
  "gnaf_id": null,
  "profile": {
    "version": 1,
    "buyer_type": "first_home",
    "budget_max": 1300000,
    "household": "couple",
    "min_bedrooms": 2,
    "vibe": "buzzing",
    "commute_modes": ["train", "bus"],
    "must_haves": ["supermarket", "restaurant"],
    "weights": { "lifestyle": 40, "price": 35, "safety": 25 }
  }
}
```

### Responses

Each outcome below returns HTTP 200. Branch on `status`.

**`matched`**

```json
{
  "status": "matched",
  "query": "26 Tudor Street, Surry Hills NSW 2010",
  "property": {
    "gnaf_id": "GANSW000000000",
    "address": "26 Example Street, Surry Hills",
    "suburb": "Surry Hills",
    "dwelling_type": "house",
    "bed_count": 3,
    "bath_count": 2,
    "parking_count": 1,
    "land_area_sqm": 120.0
  },
  "match": {
    "overall": 82,
    "label": "Strong match",
    "summary": "Fits your budget and your walkable lifestyle. Flood risk is the one to check.",
    "pillars": [
      {
        "key": "lifestyle",
        "label": "Lifestyle & Community",
        "score": 91,
        "weight": 0.4,
        "summary": "Everything you asked for is a short walk away.",
        "factors": [
          {
            "key": "transport",
            "label": "Train",
            "value": "450 m",
            "score": 90,
            "impact": "positive",
            "detail": "Nearest train stop is a 6 minute walk.",
            "source": "/v1/properties/{gnaf_id}/transport/nearby"
          }
        ]
      }
    ],
    "dealbreakers": []
  },
  "data_gaps": []
}
```

- `property.address` is the address we matched, not the one we were sent. Always show it, because judges check it.
- `pillars` always has the keys `lifestyle`, `price` and `safety`. Weights add up to 1.
- Scores are whole numbers from 0 to 100. `impact` is `positive`, `neutral` or `negative`.
- `dealbreakers` is a list of `{ "key", "message" }`, for example when the home is well over budget.
- `data_gaps` lists facts Microburbs had no data for, as plain sentences.

**`ambiguous`**: we can't be sure which home it is, usually a building with several units. Show the candidates and resend the chosen `gnaf_id`.

```json
{
  "status": "ambiguous",
  "query": "26 Example Street, Surry Hills",
  "candidates": [
    { "gnaf_id": "GANSW000000001", "address": "1/26 Example Street, Surry Hills", "property_type": "unit" }
  ]
}
```

**`no_match`**: same shape as `ambiguous`, and `candidates` may be empty.

**`out_of_area`**: the address is outside the City of Sydney, the only area this API covers.

```json
{ "status": "out_of_area", "query": "1 Example Road, Melbourne VIC", "message": "MicroMatch covers the City of Sydney only for now." }
```

### Errors

Errors use a 4xx or 5xx status.

```json
{ "status": "error", "code": "missing_address", "message": "Send an address or a gnaf_id." }
```

## Accounts and saved quizzes

The website uses these routes. Local base URL: `http://localhost:8001/api`. Send `Authorization: Bearer <token>` on every route except register and login.

| Route | Body | Returns |
| --- | --- | --- |
| `POST /auth/register` | `name`, `email`, `password` | `token`, `user` |
| `POST /auth/login` | `email`, `password` | `token`, `user` |
| `POST /auth/logout` | none | `status` |
| `GET /me` | none | `user`, `latest_quiz`, `history` |
| `POST /quiz-results` | `answers`, `weights`, `categories`, `archetype`, `details`, `extension_profile` | the saved result |

Each retake adds a new result, and the newest one is the live profile. The side panel logs in with the same routes, then loads `latest_quiz` from `GET /me` into `chrome.storage.local`: `extension_profile` (README Contract 1) plus `metricWeights`, the 11 stored weights. `score.js` multiplies each signal by its metric weight. The website also posts the profile to `extension/src/site-bridge.js` straight after a save.
