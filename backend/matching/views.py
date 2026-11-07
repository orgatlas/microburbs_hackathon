"""HTTP layer. The response shapes are defined in docs/API_CONTRACT.md."""
import json

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST


def error(code, message, status):
    return JsonResponse({"status": "error", "code": code, "message": message}, status=status)


@require_GET
def health(request):
    return JsonResponse({"status": "ok"})


@csrf_exempt
@require_POST
def match(request):
    try:
        body = json.loads(request.body)
    except ValueError:
        return error("invalid_json", "Request body must be JSON.", 400)
    if not isinstance(body, dict) or not (body.get("address") or body.get("gnaf_id")):
        return error("missing_address", "Send an address or a gnaf_id.", 400)

    # There is no mock mode. Until real matching lands here (see backend/SPEC.md),
    # the extension's facts come from the live proxy.
    return error(
        "not_implemented",
        "Matching runs in the proxy for now: GET http://localhost:3000/lookup?address=...",
        501,
    )
