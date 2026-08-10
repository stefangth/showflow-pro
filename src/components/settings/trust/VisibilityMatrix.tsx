import { useState } from "react";
import { VISIBILITY_MATRIX, TRUST_ROLES, type TrustRole } from "@/lib/trust/facts";
import { ACCESS_TONE_CLASS } from "./accessTone";

/** Segmented control for picking the role to inspect.
 *
 *  A radiogroup rather than a tablist: there is one table below and it is
 *  re-filtered, not swapped for a different panel. Tab semantics would promise
 *  a tabpanel per trigger that does not exist. */
function RolePicker({ value, onChange }: { value: TrustRole; onChange: (r: TrustRole) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Role to inspect"
      className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {TRUST_ROLES.map((role) => {
        const selected = role.value === value;
        return (
          <button
            key={role.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(role.value)}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {role.label}
          </button>
        );
      })}
    </div>
  );
}

/** "Who can see what": pick a role, read what it can reach and why.
 *
 *  Only the three roles that exist inside an organisation are offered. Platform
 *  support access is deliberately not a column here — we would have to describe
 *  behaviour we cannot yet evidence, and a trust page is the wrong place to
 *  approximate. */
export function VisibilityMatrix() {
  const [role, setRole] = useState<TrustRole>("artist");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-md space-y-1">
          <h3 className="text-base font-semibold tracking-tight">Who can see what</h3>
          <p className="text-sm text-muted-foreground">
            Answer an artist manager on the call. Roles are per organisation and enforced in the
            database, not in the interface.
          </p>
        </div>
        <RolePicker value={role} onChange={setRole} />
      </div>

      <table className="w-full text-left">
        <caption className="sr-only">
          What the {TRUST_ROLES.find((r) => r.value === role)?.label} role can read, and the
          mechanism that decides it
        </caption>
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            <th scope="col" className="pb-2 font-semibold">Data</th>
            <th scope="col" className="pb-2 font-semibold">Access</th>
            <th scope="col" className="pb-2 font-semibold">Mechanism</th>
          </tr>
        </thead>
        <tbody>
          {VISIBILITY_MATRIX.map((row) => {
            const cell = row[role];
            return (
              <tr key={row.object} className="border-t border-border align-middle">
                <th scope="row" className="py-3 pr-4 text-sm font-medium">
                  {row.object}
                </th>
                <td className="py-3 pr-4">
                  <span
                    className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${ACCESS_TONE_CLASS[cell.tone]}`}
                  >
                    {cell.value}
                  </span>
                </td>
                <td className="py-3 text-xs leading-4 text-muted-foreground">{cell.note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
