"""Synthetic response for building against the contract. Every number here is
invented: the hackathon rules forbid committing real API output."""


def factor(key, label, value, score, impact, detail, source):
    return {
        "key": key,
        "label": label,
        "value": value,
        "score": score,
        "impact": impact,
        "detail": detail,
        "source": source,
    }


def mock_match(body):
    address = (body.get("address") or "").lower()
    if "ambiguous" in address:
        return {
            "status": "ambiguous",
            "query": body.get("address"),
            "candidates": [
                {"gnaf_id": "GANSW000000001", "address": "1/26 Example Street, Surry Hills", "property_type": "unit"},
                {"gnaf_id": "GANSW000000002", "address": "2/26 Example Street, Surry Hills", "property_type": "unit"},
            ],
        }
    if "melbourne" in address:
        return {
            "status": "out_of_area",
            "query": body.get("address"),
            "message": "MicroMatch covers the City of Sydney only for now.",
        }
    if "nowhere" in address:
        return {"status": "no_match", "query": body.get("address"), "candidates": []}

    return {
        "status": "matched",
        "mock": True,
        "query": body.get("address"),
        "property": {
            "gnaf_id": body.get("gnaf_id") or "GANSW000000000",
            "address": "26 Example Street, Surry Hills",
            "suburb": "Surry Hills",
            "dwelling_type": "house",
            "bed_count": 3,
            "bath_count": 2,
            "parking_count": 1,
            "land_area_sqm": 120.0,
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
                        factor("transport", "Train", "450 m", 90, "positive", "Nearest train stop is a 6 minute walk.", "/v1/properties/{gnaf_id}/transport/nearby"),
                        factor("amenities", "Supermarket", "240 m", 95, "positive", "Nearest supermarket is a 3 minute walk.", "/v1/properties/{gnaf_id}/amenities/nearby"),
                    ],
                },
                {
                    "key": "price",
                    "label": "Price",
                    "score": 78,
                    "weight": 0.35,
                    "summary": "The estimated value sits inside your budget.",
                    "factors": [
                        factor("avm_vs_budget", "Estimated value", "$1.24M", 78, "positive", "About $60k under your $1.3M limit. The likely range is $1.18M to $1.31M.", "/v1/properties/{gnaf_id}/valuation/avm"),
                    ],
                },
                {
                    "key": "safety",
                    "label": "Safety",
                    "score": 72,
                    "weight": 0.25,
                    "summary": "Crime is near average, with one nearby hazard.",
                    "factors": [
                        factor("crime", "Crime vs national", "+4%", 70, "neutral", "Suburb crime is close to the national median.", "/v1/suburbs/{suburb_name}/crime/summary"),
                        factor("flood", "Flood overlay", "120 m away", 60, "negative", "Not on the property, but the nearest overlay is 120 m away.", "/v1/properties/{gnaf_id}/risks/all"),
                    ],
                },
            ],
            "dealbreakers": [],
        },
        "data_gaps": [],
    }
