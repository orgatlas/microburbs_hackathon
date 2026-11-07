"""Accounts and saved quizzes. Clients send `Authorization: Bearer <token>`."""
import json
from functools import wraps

from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from .models import AuthToken, QuizResult, hash_token

User = get_user_model()
METRICS = {"dist", "pt", "park", "peak", "live", "amen", "comm", "val", "dev", "rates", "afford"}
MAX_BODY_BYTES = 20_000


def error(code, message, status):
    return JsonResponse({"status": "error", "code": code, "message": message}, status=status)


def read_json(request):
    if len(request.body) > MAX_BODY_BYTES:
        return None
    try:
        body = json.loads(request.body)
    except ValueError:
        return None
    return body if isinstance(body, dict) else None


def token_from(request):
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    token = AuthToken.objects.select_related("user").filter(token_hash=hash_token(header[7:])).first()
    if token is None:
        return None
    if token.expired:
        token.delete()
        return None
    return token


def login_required(view):
    @wraps(view)
    def wrapper(request, *args, **kwargs):
        token = token_from(request)
        if token is None:
            return error("not_logged_in", "Please log in.", 401)
        request.auth_token = token
        request.account = token.user
        return view(request, *args, **kwargs)

    return wrapper


def user_json(user):
    return {"name": user.first_name, "email": user.email}


def result_json(result):
    return {
        "id": result.id,
        "answers": result.answers,
        "weights": result.weights,
        "categories": result.categories,
        "archetype": result.archetype,
        "details": result.details,
        "extension_profile": result.extension_profile,
        "created_at": result.created_at.isoformat(),
    }


@csrf_exempt
@require_POST
def register(request):
    body = read_json(request)
    if body is None:
        return error("invalid_json", "Request body must be JSON.", 400)
    name = str(body.get("name", "")).strip()[:150]
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))
    if not name:
        return error("invalid_name", "Tell us your name.", 400)
    try:
        validate_email(email)
    except ValidationError:
        return error("invalid_email", "Enter a valid email address.", 400)
    if User.objects.filter(username=email).exists():
        return error("email_taken", "That email already has an account. Try logging in.", 409)
    try:
        validate_password(password, User(username=email, email=email, first_name=name))
    except ValidationError as problem:
        return error("weak_password", " ".join(problem.messages), 400)
    user = User.objects.create_user(username=email, email=email, password=password, first_name=name)
    return JsonResponse({"token": AuthToken.issue(user), "user": user_json(user)}, status=201)


@csrf_exempt
@require_POST
def login(request):
    body = read_json(request)
    if body is None:
        return error("invalid_json", "Request body must be JSON.", 400)
    email = str(body.get("email", "")).strip().lower()
    user = authenticate(request, username=email, password=str(body.get("password", "")))
    if user is None:
        return error("invalid_login", "That email or password isn't right.", 401)
    return JsonResponse({"token": AuthToken.issue(user), "user": user_json(user)})


@csrf_exempt
@require_POST
@login_required
def logout(request):
    request.auth_token.delete()
    return JsonResponse({"status": "ok"})


@require_GET
@login_required
def me(request):
    results = request.account.quiz_results.all()
    latest = results.first()
    return JsonResponse({
        "user": user_json(request.account),
        "latest_quiz": result_json(latest) if latest else None,
        "history": [
            {"id": r.id, "archetype": r.archetype, "categories": r.categories, "created_at": r.created_at.isoformat()}
            for r in results[:10]
        ],
    })


def valid_result(body):
    weights = body.get("weights")
    if not isinstance(weights, dict) or set(weights) != METRICS:
        return False
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= 1 for v in weights.values()):
        return False
    if abs(sum(weights.values()) - 1) > 0.001:
        return False
    return (
        isinstance(body.get("answers"), list)
        and isinstance(body.get("categories"), dict)
        and isinstance(body.get("details"), dict)
        and isinstance(body.get("extension_profile"), dict)
        and isinstance(body.get("archetype"), str)
        and 0 < len(body["archetype"]) <= 60
    )


@csrf_exempt
@require_http_methods(["POST"])
@login_required
def save_quiz(request):
    body = read_json(request)
    if body is None or not valid_result(body):
        return error("invalid_quiz", "That quiz result isn't valid.", 400)
    result = QuizResult.objects.create(
        user=request.account,
        answers=body["answers"],
        weights=body["weights"],
        categories=body["categories"],
        archetype=body["archetype"],
        details=body["details"],
        extension_profile=body["extension_profile"],
    )
    return JsonResponse(result_json(result), status=201)
