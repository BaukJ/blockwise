"""Google OAuth sign-in. Email is the identity; account auto-created on first login."""
from __future__ import annotations

from datetime import datetime, timezone

from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse

from app.config import settings
from app.models import LoginMethod, UserModel
from app.security import create_access_token, set_auth_cookie

router = APIRouter()

oauth = OAuth()
if settings.google_client_id and settings.google_client_secret:
    oauth.register(
        name="google",
        client_id=settings.google_client_id,
        client_secret=settings.google_client_secret,
        server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
        client_kwargs={"scope": "openid email profile"},
    )


def _frontend_url(path: str) -> str:
    scheme = "http" if settings.is_local else "https"
    host = "localhost" if settings.is_local else settings.domain
    return f"{scheme}://{host}{path}"


@router.get("/login")
async def login(request: Request):
    redirect_uri = _frontend_url("/api/auth/google/callback")
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/callback")
async def callback(request: Request):
    token = await oauth.google.authorize_access_token(request)
    info = token.get("userinfo") or {}
    email = (info.get("email") or "").lower()
    if not email:
        return RedirectResponse(_frontend_url("/login?error=google"))

    try:
        user = UserModel.get(email)
        methods = set(user.login_methods or [])
        if LoginMethod.GOOGLE.value not in methods:
            methods.add(LoginMethod.GOOGLE.value)
            user.update(actions=[UserModel.login_methods.set(methods)])
    except UserModel.DoesNotExist:
        UserModel(
            email=email,
            login_methods={LoginMethod.GOOGLE.value},
            created_at=datetime.now(timezone.utc),
        ).save()

    response = RedirectResponse(_frontend_url("/"))
    set_auth_cookie(response, create_access_token(email))
    return response
