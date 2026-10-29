import { useCallback, useEffect, useMemo, useState } from "react";
import { call, loadRole, saveRole, ROLES, type Role } from "./api";
import Settings from "./Settings";
import MapTable from "./MapTable";
import Workflow from "./Workflow";
import { BLOOM_NAMES, type GenerateReply, type SpecSummary, type SpecView } from "./types";

const TEMPLATE_LABEL = { integrated: "Integrated (theory + lab)", non_lab: "Non-Lab (theory only)" } as const;

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [health, setHealth] = useState("checking…");
  const [role, setRole] = useState<Role>(loadRole());
  const [specFile, setSpecFile] = useState<File | null>(null);
  const [blueprintFile, setBlueprintFile] = useState<File | null>(null);
  const [override, setOverride] = useState<{ template: string; reason: string }>({ template: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spec, setSpec] = useState<SpecView | null>(null);
  const [specs, setSpecs] = useState<SpecSummary[]>([]);
  const [aiUsed, setAiUsed] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    call<{ status: string }>("/health")
      .then((d) => setHealth(d.status === "up" ? "connected" : d.status))
      .catch(() => setHealth("server not reachable"));
  }, []);

  const refreshList = useCallback(() => {
    call<{ specs: SpecSummary[] }>("/specs")
      .then((d) => setSpecs(d.specs))
      .catch(() => setSpecs([]));
  }, []);

  useEffect(refreshList, [refreshList, role]);

  function switchRole(next: Role) {
    setRole(next);
    saveRole(next);
    if (spec) call<SpecView>(`/specs/${spec.id}`).then(setSpec).catch(() => undefined);
  }

  async function generate() {
    if (!specFile) {
      setError("Choose the existing course specification first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("spec", specFile);
      if (blueprintFile) form.append("blueprint", blueprintFile);
      if (override.template) {
        if (!override.reason.trim()) throw new Error("A template override needs a reason.");
        form.append("template", override.template);
        form.append("template_reason", override.reason.trim());
      }
      const reply = await call<GenerateReply>("/generate", { method: "POST", body: form });
      setAiUsed(reply.ai_used);
      const view = await call<SpecView>(`/specs/${reply.spec_id}`);
      setSpec(view);
      setPreview(true);
      refreshList();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function editCell(co: string, column: string, level: 0 | 1 | 2 | 3, justification?: string) {
    if (!spec) return;
    const updated = await call<SpecView>(`/specs/${spec.id}`, {
      method: "PATCH",
      body: JSON.stringify({ cells: [{ co, column, level, justification }] }),
    });
    setSpec(updated);
  }

  async function transition(action: string, comment: string | null) {
    if (!spec) return;
    const updated = await call<SpecView>(`/specs/${spec.id}/transition`, { method: "POST", body: JSON.stringify({ action, comment }) });
    setSpec(updated);
    refreshList();
  }

  async function addComment(section: number | null, text: string) {
    if (!spec) return;
    await call(`/specs/${spec.id}/comments`, { method: "POST", body: JSON.stringify({ section, text }) });
    setSpec(await call<SpecView>(`/specs/${spec.id}`));
  }

  async function open(id: string) {
    setError(null);
    try {
      setSpec(await call<SpecView>(`/specs/${id}`));
      setPreview(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function download(name: string, text: string, type: string) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  const bySeverity = useMemo(() => {
    const order = { High: 0, Medium: 1, Low: 2 } as const;
    return [...(spec?.defects ?? [])].sort((a, b) => order[a.severity] - order[b.severity]);
  }, [spec]);

  return (
    <>
      <header className="bar">
        <h1>
          SpecForge <small>Course Specification Builder</small>
        </h1>
        <span className={`pill ${health === "connected" ? "sage" : "clay"}`}>Server {health}</span>
        {aiUsed && <span className="pill clay">AI assisted</span>}
        <div className="spacer" />
        <label style={{ margin: 0 }}>
          <select value={role} onChange={(e) => switchRole(e.target.value as Role)} aria-label="Role" style={{ width: 130 }}>
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <button className="ghost" onClick={() => setSettingsOpen(true)}>Settings</button>
      </header>

      <main>
        <section className="card">
          <header>
            <h2>Upload the inputs</h2>
            <div className="spacer" />
            <span className="lede">.docx · .doc · .pdf · .html</span>
          </header>
          <div className="grid two">
            <div className="dropzone">
              <label>
                Existing course specification (required)
                <input type="file" accept=".docx,.doc,.pdf,.html,.htm" onChange={(e) => setSpecFile(e.target.files?.[0] ?? null)} />
              </label>
              <span className="lede">{specFile ? specFile.name : "No file chosen"}</span>
            </div>
            <div className="dropzone">
              <label>
                Question-paper blueprint (optional, decides the COs and units)
                <input type="file" accept=".docx,.doc,.pdf,.html,.htm" onChange={(e) => setBlueprintFile(e.target.files?.[0] ?? null)} />
              </label>
              <span className="lede">{blueprintFile ? blueprintFile.name : "No file chosen"}</span>
            </div>
          </div>
          <div className="grid two" style={{ marginTop: 12 }}>
            <label>
              Template override (optional)
              <select value={override.template} onChange={(e) => setOverride({ ...override, template: e.target.value })}>
                <option value="">Detect from the credit structure</option>
                <option value="integrated">Force Integrated</option>
                <option value="non_lab">Force Non-Lab</option>
              </select>
            </label>
            <label>
              Reason for the override
              <input type="text" value={override.reason} onChange={(e) => setOverride({ ...override, reason: e.target.value })} placeholder="Required when you override" />
            </label>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <button onClick={generate} disabled={busy || role !== "Author"}>
              {busy ? "Correcting…" : "Generate corrected spec"}
            </button>
            {role !== "Author" && <span className="lede">Only the Author can run a generation.</span>}
            {error && <span className="bad">{error}</span>}
          </div>
        </section>

        {!spec && (
          <section className="card">
            <header><h2>Specifications</h2><div className="spacer" /><span className="pill">{specs.length}</span></header>
            {specs.length === 0 ? (
              <p className="empty">Nothing generated yet. Upload a spec and a blueprint to begin.</p>
            ) : (
              <table>
                <thead><tr><th>Code</th><th>Title</th><th>Status</th><th className="center">Defects</th><th>Updated</th><th /></tr></thead>
                <tbody>
                  {specs.map((s) => (
                    <tr key={s.id}>
                      <td>{s.code}</td>
                      <td>{s.title}</td>
                      <td><span className="pill ink">{s.status}</span></td>
                      <td className="center">{s.defects}</td>
                      <td>{new Date(s.updatedAt).toLocaleTimeString()}</td>
                      <td><button className="link" onClick={() => open(s.id)}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {spec && (
          <>
            <section className="card">
              <header>
                <h2>{spec.output.course.code} · {spec.output.course.title}</h2>
                <div className="spacer" />
                <button className="ghost" onClick={() => { setSpec(null); refreshList(); }}>All specs</button>
              </header>
              <div className="grid three">
                <div>
                  <p className="lede">Department</p>
                  <p>{spec.output.course.department}</p>
                </div>
                <div>
                  <p className="lede">Credits (L:T:P)</p>
                  <p>{spec.output.course.credits_ltp} · {spec.output.course.course_type}</p>
                </div>
                <div>
                  <p className="lede">Template</p>
                  <p>{TEMPLATE_LABEL[spec.output.template]}</p>
                </div>
                <div>
                  <p className="lede">Teaching hours</p>
                  <p>
                    {spec.output.teaching_hours.lectures} lecture · {spec.output.teaching_hours.lab} lab ·{" "}
                    {spec.output.teaching_hours.tests_exams} exams = {spec.output.teaching_hours.total}
                  </p>
                </div>
                <div>
                  <p className="lede">Assessment</p>
                  <p>{spec.output.assessment.components.map((c) => `${c.name} ${c.weight_percent}%`).join(" · ")}</p>
                </div>
                <div>
                  <p className="lede">Scoring file</p>
                  <p>input_id {spec.output.input_id} · schema {spec.output.schema_version}</p>
                </div>
              </div>
              <h3 style={{ marginTop: 14 }}>Summary</h3>
              <p>{spec.output.course.summary}</p>
              <div className="row">
                {spec.signals.map((s, i) => (
                  <span key={i} className="pill">{s}</span>
                ))}
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="ghost" onClick={() => download("specforge_output.json", JSON.stringify(spec.output, null, 2), "application/json")}>
                  Download output JSON
                </button>
                <button className="ghost" onClick={() => window.open(`/api/v1/specs/${spec.id}/spec.html`, "_blank")}>Open spec.html</button>
                <button className="ghost" onClick={() => window.open(`/api/v1/specs/${spec.id}/report.html`, "_blank")}>Validation report</button>
                <button className="ghost" onClick={() => setPreview((p) => !p)}>{preview ? "Hide preview" : "Show preview"}</button>
              </div>
            </section>

            <section className="card">
              <header>
                <h2>Course outcomes</h2>
                <span className="pill">{spec.output.course_outcomes.length}</span>
                <div className="spacer" />
                <span className="lede">Bloom level comes from the leading verb</span>
              </header>
              <ul className="colist">
                {spec.output.course_outcomes.map((co) => (
                  <li key={co.id}>
                    <div className="row">
                      <strong>{co.id}</strong>
                      <span className="pill clay">L{co.bloom_level} {BLOOM_NAMES[co.bloom_level]}</span>
                      <span className="pill">{(spec.output.assessment.co_coverage[co.id] ?? []).join(", ")}</span>
                    </div>
                    {co.statement}
                  </li>
                ))}
              </ul>
            </section>

            <MapTable output={spec.output} canEdit={spec.canEdit} onEdit={editCell} />

            <section className="card">
              <header>
                <h2>Validation report</h2>
                <span className="pill clay">{spec.defects.filter((d) => d.severity === "High").length} high</span>
                <span className="pill amber">{spec.defects.filter((d) => d.severity === "Medium").length} medium</span>
                <span className="pill">{spec.defects.filter((d) => d.severity === "Low").length} low</span>
              </header>
              {bySeverity.length === 0 ? (
                <p className="empty">No defects found in these inputs.</p>
              ) : (
                bySeverity.map((d, i) => (
                  <div key={i} className={`defect ${d.severity}`}>
                    <div className="row">
                      <code>{d.code}</code>
                      <span className="pill">{d.location.source}{d.location.section ? ` · section ${d.location.section}` : ""}</span>
                      {d.location.refs.length > 0 && <span className="pill ink">{d.location.refs.join(", ")}</span>}
                      {d.rule && <span className="pill">{d.rule}</span>}
                    </div>
                    <p style={{ margin: "6px 0 2px" }}>{d.description}</p>
                    <p className="fix">Fix applied: {d.fix}</p>
                  </div>
                ))
              )}
              {spec.notes.length > 0 && (
                <>
                  <h3 style={{ marginTop: 12 }}>Decisions and conflicts</h3>
                  <ul className="log">
                    {spec.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section className="card">
              <header>
                <h2>Units</h2>
                <span className="pill">{spec.output.units.length}</span>
              </header>
              <table>
                <thead><tr><th className="center">Unit</th><th>Title</th><th>Lab exercises</th></tr></thead>
                <tbody>
                  {spec.output.units.map((u) => (
                    <tr key={u.number}>
                      <td className="center">{u.number}</td>
                      <td>{u.title}</td>
                      <td>{u.lab ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <Workflow spec={spec} role={role} onTransition={transition} onComment={addComment} />

            {preview && (
              <section className="card">
                <header>
                  <h2>Document preview</h2>
                  <div className="spacer" />
                  <span className="lede">{spec.status === "Approved" ? "Approved: no watermark" : "DRAFT watermark until approval"}</span>
                </header>
                <iframe className="preview" title="spec preview" src={`/api/v1/specs/${spec.id}/spec.html`} />
              </section>
            )}
          </>
        )}
      </main>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
