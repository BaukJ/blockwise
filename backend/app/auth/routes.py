"""Base auth: current user, logout, role switching."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from app.models import Role, UserModel
from app.security import clear_auth_cookie, get_current_user

router = APIRouter()


class UserOut(BaseModel):
    email: str
    active_role: str | None
    login_methods: list[str]
    admin: bool


class RoleIn(BaseModel):
    role: Role


def serialize_user(user: UserModel) -> UserOut:
    return UserOut(
        email=user.email,
        active_role=user.active_role,
        login_methods=sorted(user.login_methods or []),
        admin=bool(user.admin),
    )


@router.get("/me", response_model=UserOut)
def me(user: UserModel = Depends(get_current_user)):
    return serialize_user(user)


@router.post("/role", response_model=UserOut)
def set_role(body: RoleIn, user: UserModel = Depends(get_current_user)):
    user.update(actions=[UserModel.active_role.set(body.role.value)])
    return serialize_user(user)


@router.post("/logout")
def logout(response: Response):
    clear_auth_cookie(response)
    return {"ok": True}
