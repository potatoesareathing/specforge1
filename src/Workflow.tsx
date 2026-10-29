import { useState } from "react";
import { WORKFLOW, type SpecView } from "./types";
import type { Role } from "./api";

type Props = {
  spec: SpecView;
  role: Role;
  onTransition: (action: string, comment: string | null) => Promise<void>;
  onComment: (section: number | null, text: string) => Promise<void>;
};

const LABELS: Record<string, string> = {
  submit: "Submit to Reviewer",
  open: "Start review",
  forward: "Forward to HOD",
  return: "Return to Author",
  approve: "Approve",
};

/** Status timeline, the actions this role may take, comments and the audit log. */
export default function Workflow({ spec, role, onTransition, onComment }: Props) {
  const [comment, setComment] = useState("");
  const [section, setSection] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = WORKFLOW.indexOf(spec.status);

  async function run(action: string) {
    setBusy(true);
    setError(null);
    try {
      await onTransition(action, comment.trim() || null);
      setComment("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addComment() {
    setBusy(true);
    setError(null);
    try {
      await onComment(section ? Number(section) : null, comment);
      setComment("");
      setSection("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <header>
        <h2>Approval workflow</h2>
        <span className={`pill ${spec.status === "Approved" ? "sage" : spec.status === "Returned" ? "clay" : "ink"}`}>{spec.status}</span>
        <div className="spacer" />
        <span className="lede">Acting as {role}</span>
      </header>

      <div className="timeline">
        {WORKFLOW.map((state, i) => (
          <span key={state} className={`step ${state === spec.status ? "now" : current > i && spec.status !== "Returned" ? "done" : ""}`}>
            {state}
          </span>
        ))}
        {spec.status === "Returned" && <span className="step now">Returned to Author</span>}
      </div>

      <div className="grid two">
        <div>
          <label>
            Comment {role === "Author" ? "(sent with the submission)" : "(required when returning)"}
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What needs to change, and where." />
          </label>
          {role !== "Author" && (
            <label>
              Section for this comment (1 to 12, optional)
              <input type="text" value={section} onChange={(e) => setSection(e.target.value.replace(/\D/g, ""))} placeholder="5" />
            </label>
          )}
          <div className="row">
            {spec.actions.map((action) => (
              <button key={action} onClick={() => run(action)} disabled={busy} className={action === "return" ? "ghost" : ""}>
                {LABELS[action] ?? action}
              </button>
            ))}
            {role !== "Author" && (
              <button className="ghost" onClick={addComment} disabled={busy || !comment.trim()}>
                Add comment
              </button>
            )}
            {!spec.actions.length && <span className="lede">Nothing for {role} to do in “{spec.status}”.</span>}
          </div>
          {error && <p className="bad">{error}</p>}
        </div>

        <div>
          <h3>History</h3>
          <ul className="log">
            {spec.log.map((entry, i) => (
              <li key={i}>
                <strong>{entry.role}</strong> {entry.action} · {entry.from} → {entry.to} · {new Date(entry.at).toLocaleTimeString()}
                {entry.comment ? ` · “${entry.comment}”` : ""}
              </li>
            ))}
          </ul>
          {spec.comments.length > 0 && (
            <>
              <h3 style={{ marginTop: 14 }}>Comments</h3>
              <ul className="log">
                {spec.comments.map((c) => (
                  <li key={c.id}>
                    <strong>{c.role}</strong>{c.section ? ` · section ${c.section}` : ""} · {c.text}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
