"""Choice rules (item 14). Rules are stored on the timetable as a list of dicts and
enforced as HARD limits wherever choices are entered (student submit, teacher add /
edit / CSV import) — so only rule-compliant choices ever reach the solver.

Rule types (each a dict in TimetableModel.rules):
  {"type": "position_in",   "position": 1, "subjects": [...]}  choice N must be in set
  {"type": "require_one_of", "subjects": [...], "min": 1}       at least N of set chosen
  {"type": "only_at",        "subjects": [...], "positions": [1]} subjects allowed only
                                                                 at these choice positions
Rules apply to the ranked CHOICES (by position), not backups.
"""
from __future__ import annotations


def check_rules(rules: list[dict], choices: list[str]) -> list[str]:
    """Return a list of human-readable violations ([] if all satisfied)."""
    errors: list[str] = []
    for rule in rules or []:
        t = rule.get("type")
        subs = set(rule.get("subjects") or [])
        if t == "position_in":
            pos = int(rule.get("position", 0))
            if 1 <= pos <= len(choices) and choices[pos - 1] not in subs:
                errors.append(
                    f"Choice {pos} must be one of: {', '.join(sorted(subs))}"
                )
        elif t == "require_one_of":
            need = int(rule.get("min", 1))
            have = sum(1 for c in choices if c in subs)
            if have < need:
                errors.append(
                    f"Pick at least {need} of: {', '.join(sorted(subs))}"
                )
        elif t == "only_at":
            positions = {int(p) for p in rule.get("positions") or []}
            for idx, c in enumerate(choices, start=1):
                if c in subs and idx not in positions:
                    allowed = ", ".join(str(p) for p in sorted(positions))
                    errors.append(f"{c} may only be chosen at position(s): {allowed}")
    return errors


def rules_error(rules: list[dict], choices: list[str]) -> str | None:
    """Single combined message, or None when compliant."""
    errors = check_rules(rules, choices)
    return "; ".join(errors) if errors else None
