import type { Rule } from "./api";

// Mirrors backend app/rules.py — returns human-readable violations ([] if compliant).
export function checkRules(rules: Rule[], choices: string[]): string[] {
  const errors: string[] = [];
  for (const rule of rules ?? []) {
    if (rule.type === "position_in") {
      const subs = rule.subjects;
      if (rule.position >= 1 && rule.position <= choices.length) {
        if (!subs.includes(choices[rule.position - 1])) {
          errors.push(`Choice ${rule.position} must be one of: ${subs.join(", ")}`);
        }
      }
    } else if (rule.type === "require_one_of") {
      const have = choices.filter((c) => rule.subjects.includes(c)).length;
      if (have < rule.min) {
        errors.push(`Pick at least ${rule.min} of: ${rule.subjects.join(", ")}`);
      }
    } else if (rule.type === "only_at") {
      choices.forEach((c, idx) => {
        if (rule.subjects.includes(c) && !rule.positions.includes(idx + 1)) {
          errors.push(`${c} may only be chosen at position(s): ${rule.positions.join(", ")}`);
        }
      });
    }
  }
  return errors;
}

// Subjects selectable at a given 1-based choice position, given the rules.
export function allowedAtPosition(
  rules: Rule[],
  position: number,
  all: string[],
): string[] {
  let allowed = all;
  for (const rule of rules ?? []) {
    if (rule.type === "position_in" && rule.position === position) {
      allowed = allowed.filter((s) => rule.subjects.includes(s));
    }
    if (rule.type === "only_at" && !rule.positions.includes(position)) {
      // Subjects locked to other positions can't appear here.
      allowed = allowed.filter((s) => !rule.subjects.includes(s));
    }
  }
  return allowed;
}
