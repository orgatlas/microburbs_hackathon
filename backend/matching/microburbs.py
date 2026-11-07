"""Thin Microburbs API client. All calls go through get() so auth, caching and
429 handling stay in one place."""
import time
from urllib.parse import quote

import requests
from django.conf import settings
from django.core.cache import cache

CACHE_SECONDS = 60 * 60 * 6


class OutOfArea(Exception):
    """Microburbs returned 403: the place is outside the City of Sydney."""


def get(path, params=None, retries=2):
    """GET a /v1 path and return its `data` value, or None when there is no data.

    Microburbs answers "no data" with HTTP 200 and `data: null`, so callers must
    treat None as a gap in the facts, not as an error.
    """
    key = "mb:" + quote(path + "?" + str(sorted((params or {}).items())), safe="")[:200]
    cached = cache.get(key, "miss")
    if cached != "miss":
        return cached

    for attempt in range(retries + 1):
        response = requests.get(
            settings.MICROBURBS_BASE_URL + path,
            params=params,
            headers={"Authorization": f"Bearer {settings.MICROBURBS_API_KEY}"},
            timeout=10,
        )
        if response.status_code == 429 and attempt < retries:
            time.sleep(float(response.headers.get("Retry-After", 1)))
            continue
        break

    if response.status_code == 403:
        raise OutOfArea(path)
    response.raise_for_status()

    data = response.json().get("data")
    cache.set(key, data, CACHE_SECONDS)
    return data
