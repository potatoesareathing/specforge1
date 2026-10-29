import { useState } from "react";
import { BLOOM_NAMES, PO_COLUMNS, type SpecOutput } from "./types";

type Props = {
  output: SpecOutput;
  canEdit: boolean;
  onEdit: (co: string, column: string, level: 0 | 1 | 2 | 3, justification?: string) => Promise<void>;
};

/** The CO-PO-PSO map. Cells are coloured by strength and carry their justification. */
export default function MapTable({ output, canEdit, onEdit }: Props) {
  const [editing, setEditing] = useState<{ co: string; column: string } | null>(null);
  const [level, setLevel] = useState<0 | 1 | 2 | 3>(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const open = (co: string, column: string) => {
    if (!canEdit) return;
    const cell = output.co_po_pso_map[co]?.[column];
    setEditing({ co, column });
    setLevel((cell?.level ?? 0) as 0 | 1 | 2 | 3);
    setReason(cell?.justification ?? "");
  };

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      await onEdit(editing.co, editing.column, level, reason.trim() || undefined);
      setEditing(null);
    } finally {
      setBusy(false);
    }
  }

  const filled = Object.values(output.co_po_pso_map).reduce((a, row) => a + Object.keys(row).length, 0);

  return (
    <section className="card">
      <header>
        <h2>CO-PO-PSO map</h2>
        <span className="pill">{filled} mapped cells</span>
        <div className="spacer" />
        <span className="lede">{canEdit ? "Click a cell to change it" : "Read only in this state"}</span>
      </header>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Course outcome</th>
              <th className="center">Bloom</th>
              {PO_COLUMNS.map((c) => (
                <th key={c} className="center">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {output.course_outcomes.map((co) => {
              const row = output.co_po_pso_map[co.id] ?? {};
              return (
                <tr key={co.id}>
                  <td title={co.statement}><strong>{co.id}</strong> {co.statement.slice(0, 48)}{co.statement.length > 48 ? "…" : ""}</td>
                  <td className="center bloom" title={BLOOM_NAMES[co.bloom_level]}>L{co.bloom_level}</td>
                  {PO_COLUMNS.map((column) => {
                    const cell = row[column];
                    return (
                      <td
                        key={column}
                        className={`cell ${cell ? `l${cell.level}` : ""} ${canEdit ? "edit" : ""}`}
                        title={cell ? cell.justification : "blank: no evidence"}
                        onClick={() => open(co.id, column)}
                      >
                        {cell?.level ?? ""}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="lede" style={{ marginTop: 10 }}>3 very strong · 2 strong · 1 moderate · blank none. Hover a cell for the reason behind it.</p>

      {editing && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Edit mapping cell">
          <div className="panel">
            <h2>{editing.co} → {editing.column}</h2>
            <p className="hint">The server re-checks the Bloom ceiling and the evidence rules when the spec is re-rendered.</p>
            <label>
              Strength
              <select value={level} onChange={(e) => setLevel(Number(e.target.value) as 0 | 1 | 2 | 3)}>
                <option value={0}>blank (no relation)</option>
                <option value={1}>1 moderate</option>
                <option value={2}>2 strong</option>
                <option value={3}>3 very strong</option>
              </select>
            </label>
            <label>
              Justification
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="One line: why this outcome supports this programme outcome." />
            </label>
            <div className="row">
              <button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save cell"}</button>
              <button className="ghost" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
