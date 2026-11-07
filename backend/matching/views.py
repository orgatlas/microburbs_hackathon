"""HTTP layer. The response shapes are defined in docs/API_CONTRACT.md."""
import json

from django.conf import settings
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from .mock import mock_match
from .quiz import QUIZ


def error(code, message, status):
    return JsonResponse({"status": "error", "code": code, "message": message}, status=status)


@require_GET
def health(request):
    return JsonResponse({"status": "ok", "mock": settings.MATCH_MOCK})


@require_GET
def quiz(request):
    return JsonResponse(QUIZ)


@csrf_exempt
@require_POST
def match(request):
    try:
        body = json.loads(request.body)
    except ValueError:
        return error("invalid_json", "Request body must be JSON.", 400)
    if not isinstance(body, dict) or not (body.get("address") or body.get("gnaf_id")):
        return error("missing_address", "Send an address or a gnaf_id.", 400)

    if settings.MATCH_MOCK:
        return JsonResponse(mock_match(body))

    # TODO(Carl): resolve the address, fetch facts, then score. See backend/SPEC.md.
    return error("not_implemented", "Real matching is not built yet. Set MATCH_MOCK=True.", 501)
