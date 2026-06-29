import type { Rule } from "../lib/api";
import { allowedAtPosition } from "../lib/rules";

// Renders `optionsRequired` ranked choice selects + `backupsAllowed` backup selects.
// Dropdowns are filtered by rules (per-position) and to keep all picks distinct.
export default function ChoiceFields({
  subjects,
  optionsRequired,
  backupsAllowed,
  rules,
  choices,
  backups,
  setChoices,
  setBackups,
}: {
  subjects: string[];
  optionsRequired: number;
  backupsAllowed: number;
  rules: Rule[];
  choices: string[];
  backups: string[];
  setChoices: (c: string[]) => void;
  setBackups: (b: string[]) => void;
}) {
  const picked = new Set([...choices, ...backups].filter(Boolean));

  function options(forValue: string, base: string[]) {
    return base.filter((s) => !picked.has(s) || s === forValue);
  }

  return (
    <div className="space-y-3">
      {Array.from({ length: optionsRequired }, (_, i) => (
        <label key={`c${i}`} className="block text-sm">
          <span className="mb-1 block text-slate-500">Choice {i + 1}</span>
          <select
            className="input"
            value={choices[i] ?? ""}
            onChange={(e) =>
              setChoices(choices.map((v, j) => (j === i ? e.target.value : v)))
            }
          >
            <option value="">Select…</option>
            {options(choices[i] ?? "", allowedAtPosition(rules, i + 1, subjects)).map(
              (s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ),
            )}
          </select>
        </label>
      ))}

      {backupsAllowed > 0 && (
        <div className="space-y-3 border-t border-slate-100 pt-3">
          {Array.from({ length: backupsAllowed }, (_, j) => (
            <label key={`b${j}`} className="block text-sm">
              <span className="mb-1 block text-slate-500">
                Backup {backupsAllowed > 1 ? j + 1 : ""}
              </span>
              <select
                className="input"
                value={backups[j] ?? ""}
                onChange={(e) =>
                  setBackups(backups.map((v, k) => (k === j ? e.target.value : v)))
                }
              >
                <option value="">None</option>
                {options(backups[j] ?? "", subjects).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
