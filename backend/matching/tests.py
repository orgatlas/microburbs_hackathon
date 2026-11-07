import json

from django.test import TestCase


class ContractTests(TestCase):
    def post(self, body):
        return self.client.post("/api/match", json.dumps(body), content_type="application/json")

    def test_health(self):
        self.assertEqual(self.client.get("/api/health").json()["status"], "ok")

    def test_quiz_has_weights_question(self):
        ids = [q["id"] for q in self.client.get("/api/quiz").json()["questions"]]
        self.assertIn("weights", ids)

    def test_match_requires_address(self):
        self.assertEqual(self.post({}).status_code, 400)

    def test_mock_statuses(self):
        cases = {"26 Example St": "matched", "ambiguous": "ambiguous", "melbourne": "out_of_area", "nowhere": "no_match"}
        for address, status in cases.items():
            self.assertEqual(self.post({"address": address}).json()["status"], status)
