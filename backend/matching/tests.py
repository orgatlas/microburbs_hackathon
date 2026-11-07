import json

from django.conf import settings
from django.test import TestCase

NOT_IMPLEMENTED = {
    "status": "error",
    "code": "not_implemented",
    "message": "Matching runs in the proxy for now: GET http://localhost:3000/lookup?address=...",
}


class ContractTests(TestCase):
    def post(self, body):
        return self.client.post("/api/match", json.dumps(body), content_type="application/json")

    def test_health_has_no_mock_flag(self):
        self.assertEqual(self.client.get("/api/health").json(), {"status": "ok"})
        self.assertFalse(hasattr(settings, "MATCH_MOCK"))

    def test_quiz_has_weights_question(self):
        ids = [q["id"] for q in self.client.get("/api/quiz").json()["questions"]]
        self.assertIn("weights", ids)

    def test_match_validates_input_first(self):
        bad_json = self.client.post("/api/match", "not json", content_type="application/json")
        self.assertEqual((bad_json.status_code, bad_json.json()["code"]), (400, "invalid_json"))
        for body in ({}, [], {"address": ""}, {"gnaf_id": None}):
            response = self.post(body)
            self.assertEqual((response.status_code, response.json()["code"]), (400, "missing_address"), body)

    def test_match_returns_501_pointing_at_proxy(self):
        # The old mock trigger words must not produce a synthetic answer either.
        bodies = [{"address": a} for a in ("26 Tudor Street, Surry Hills NSW 2010", "ambiguous", "melbourne", "nowhere")]
        for body in bodies + [{"gnaf_id": "GANSW000000000"}]:
            response = self.post(body)
            self.assertEqual(response.status_code, 501, body)
            self.assertEqual(response.json(), NOT_IMPLEMENTED, body)
