import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

TOKEN_LIFETIME = timedelta(days=30)


def hash_token(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


class AuthToken(models.Model):
    """A login session. Only a hash is stored, so a leaked database can't be replayed."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="tokens")
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    @classmethod
    def issue(cls, user):
        raw = secrets.token_urlsafe(32)
        cls.objects.create(user=user, token_hash=hash_token(raw))
        return raw

    @property
    def expired(self):
        return timezone.now() - self.created_at > TOKEN_LIFETIME


class QuizResult(models.Model):
    """One completed quiz. Retakes add a row, so the latest row is the live profile."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="quiz_results")
    answers = models.JSONField()
    weights = models.JSONField()
    categories = models.JSONField()
    archetype = models.CharField(max_length=60)
    details = models.JSONField()
    extension_profile = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
