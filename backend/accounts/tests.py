import json

from django.test import TestCase

from .models import AuthToken

SIGNUP = {"name": "Test Person", "email": "Person@Example.com", "password": "a-long-test-passphrase-42"}
METRICS = ["dist", "pt", "park", "peak", "live", "amen", "comm", "val", "dev", "rates", "afford"]
QUIZ = {
    "answers": [["Q1", 1]],
    "weights": {metric: 1 / 11 for metric in METRICS},
    "categories": {"commuting": 0.36, "safety": 0.28, "price": 0.36},
    "archetype": "Community Builder",
    "details": {"mode": "buy", "budget": 1000000},
    "extension_profile": {"mode": "buy", "budgetPrice": 1000000},
}


class AccountTests(TestCase):
    def post(self, path, body, token=None):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self.client.post(path, json.dumps(body), content_type="application/json", headers=headers)

    def me(self, token):
        return self.client.get("/api/me", headers={"Authorization": f"Bearer {token}"})

    def signup(self):
        return self.post("/api/auth/register", SIGNUP).json()["token"]

    def test_register_login_and_logout(self):
        token = self.signup()
        self.assertEqual(self.me(token).json()["user"]["email"], "person@example.com")
        login = self.post("/api/auth/login", {"email": "person@example.com", "password": SIGNUP["password"]})
        self.assertEqual(login.status_code, 200)
        self.post("/api/auth/logout", {}, token)
        self.assertEqual(self.me(token).status_code, 401)

    def test_tokens_are_stored_hashed(self):
        token = self.signup()
        self.assertFalse(AuthToken.objects.filter(token_hash=token).exists())

    def test_bad_login_and_duplicate_email(self):
        self.signup()
        self.assertEqual(self.post("/api/auth/login", {"email": SIGNUP["email"], "password": "wrong"}).status_code, 401)
        self.assertEqual(self.post("/api/auth/register", SIGNUP).status_code, 409)

    def test_weak_password_rejected(self):
        self.assertEqual(self.post("/api/auth/register", {**SIGNUP, "password": "123"}).status_code, 400)

    def test_quiz_needs_login(self):
        self.assertEqual(self.post("/api/quiz-results", QUIZ).status_code, 401)

    def test_retake_keeps_history_and_latest_wins(self):
        token = self.signup()
        self.assertIsNone(self.me(token).json()["latest_quiz"])
        self.post("/api/quiz-results", QUIZ, token)
        self.post("/api/quiz-results", {**QUIZ, "archetype": "Value Hunter"}, token)
        profile = self.me(token).json()
        self.assertEqual(profile["latest_quiz"]["archetype"], "Value Hunter")
        self.assertEqual(len(profile["history"]), 2)

    def test_users_only_see_their_own_quiz(self):
        self.post("/api/quiz-results", QUIZ, self.signup())
        other = self.post("/api/auth/register", {**SIGNUP, "email": "other@example.com"}).json()["token"]
        self.assertIsNone(self.me(other).json()["latest_quiz"])

    def test_invalid_weights_rejected(self):
        token = self.signup()
        bad = {**QUIZ, "weights": {**QUIZ["weights"], "dist": 0.9}}
        self.assertEqual(self.post("/api/quiz-results", bad, token).status_code, 400)
