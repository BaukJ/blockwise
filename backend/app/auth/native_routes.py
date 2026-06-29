"""Email + password auth. Email is the identity — no username."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, EmailStr

from app.config import settings
from app.email import send_email
from app.models import LoginMethod, UserModel
from app.security import (
    create_access_token,
    hash_password,
    make_timed_token,
    read_timed_token,
    set_auth_cookie,
    verify_password,
)
from app.auth.routes import serialize_user

router = APIRouter()

VERIFY_SALT = "email-verify"
RESET_SALT = "password-reset"


class RegisterIn(BaseModel):
    email: EmailStr
    password: str


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class ResetConfirmIn(BaseModel):
    token: str
    new_password: str


def _frontend_url(path: str) -> str:
    scheme = "http" if settings.is_local else "https"
    host = "localhost" if settings.is_local else settings.domain
    return f"{scheme}://{host}{path}"


@router.post("/register")
def register(body: RegisterIn):
    email = body.email.lower()
    try:
        UserModel.get(email)
        raise HTTPException(status_code=409, detail="Account already exists")
    except UserModel.DoesNotExist:
        pass

    # Store the password hash inside the signed token so we don't persist an
    # unverified account. The user is only created on verification.
    token = make_timed_token(
        {"email": email, "password_hash": hash_password(body.password)}, VERIFY_SALT
    )
    link = _frontend_url(f"/verify?token={token}")
    send_email(
        email,
        "Verify your Blockwise account",
        f"Welcome to Blockwise!\n\nConfirm your email to finish signing up:\n{link}\n",
    )
    return {"ok": True, "message": "Verification email sent"}


@router.post("/verify")
def verify(body: dict, response: Response):
    token = body.get("token", "")
    data = read_timed_token(token, VERIFY_SALT)
    email = data["email"]
    try:
        UserModel.get(email)
    except UserModel.DoesNotExist:
        UserModel(
            email=email,
            password_hash=data["password_hash"],
            login_methods={LoginMethod.PASSWORD.value},
            created_at=datetime.now(timezone.utc),
        ).save()
    set_auth_cookie(response, create_access_token(email))
    user = UserModel.get(email)
    return serialize_user(user)


@router.post("/login")
def login(body: LoginIn, response: Response):
    email = body.email.lower()
    try:
        user = UserModel.get(email)
    except UserModel.DoesNotExist:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not user.password_hash or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    set_auth_cookie(response, create_access_token(email))
    return serialize_user(user)


@router.post("/password-reset")
def password_reset(body: dict):
    email = (body.get("email") or "").lower()
    try:
        UserModel.get(email)
    except UserModel.DoesNotExist:
        return {"ok": True}  # don't reveal account existence
    token = make_timed_token({"email": email}, RESET_SALT)
    link = _frontend_url(f"/reset?token={token}")
    send_email(email, "Reset your Blockwise password", f"Reset your password:\n{link}\n")
    return {"ok": True}


@router.post("/password-reset/confirm")
def password_reset_confirm(body: ResetConfirmIn, response: Response):
    data = read_timed_token(body.token, RESET_SALT)
    email = data["email"]
    try:
        user = UserModel.get(email)
    except UserModel.DoesNotExist:
        raise HTTPException(status_code=400, detail="Invalid token")
    methods = set(user.login_methods or [])
    methods.add(LoginMethod.PASSWORD.value)
    user.update(
        actions=[
            UserModel.password_hash.set(hash_password(body.new_password)),
            UserModel.login_methods.set(methods),
        ]
    )
    set_auth_cookie(response, create_access_token(email))
    return serialize_user(user)
