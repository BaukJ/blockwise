"""JWT cookie auth + password hashing + dependencies."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Request, Response, HTTPException
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from jose import JWTError, jwt

from app.config import settings
from app.models import UserModel

ALGORITHM = "HS256"


# ── Passwords ──────────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


# ── Session JWT ──────────────────────────────────────────────────────────────
def create_access_token(email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    return jwt.encode(
        {"sub": email, "exp": expire}, settings.secret_key, algorithm=ALGORITHM
    )


def set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.cookie_name,
        value=token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.access_token_expire_minutes * 60,
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(settings.cookie_name, path="/")


def get_current_user(request: Request) -> UserModel:
    token = request.cookies.get(settings.cookie_name)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        email = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if not email:
        raise HTTPException(status_code=401, detail="Invalid token")
    try:
        return UserModel.get(email)
    except UserModel.DoesNotExist:
        raise HTTPException(status_code=401, detail="User not found")


# ── Timed tokens (email verification / password reset) ───────────────────────
def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.secret_key)


def make_timed_token(payload: dict, salt: str) -> str:
    return _serializer().dumps(payload, salt=salt)


def read_timed_token(token: str, salt: str, max_age: int | None = None) -> dict:
    try:
        return _serializer().loads(
            token, salt=salt, max_age=max_age or settings.registration_token_expiry
        )
    except SignatureExpired:
        raise HTTPException(status_code=400, detail="Token expired")
    except BadSignature:
        raise HTTPException(status_code=400, detail="Invalid token")
