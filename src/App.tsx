import { useCallback, useEffect, useMemo, useState } from "react";
import { call, loadRole, saveRole, ROLES, type Role } from "./api";
import Settings from "./Settings";
import MapTable from "./MapTable";
import MapLattice from "./MapLattice";
import Workflow from "./Workflow";
import Backdrop from "./Backdrop";
import { BLOOM_NAMES, WORKFLOW, type GenerateReply, type SpecSummary, type SpecView } from "./types";

const TEMPLATE_LABEL = { integrated: "Integrated · theory + lab", non_lab: "Non-Lab · theory only" } as const;
const TABS = ["Overview", "Map", "Defects", "Document", "Workflow"] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [health, setHealth] = useState("checking");
  const [role, setRole] = useState<Role>(loadRole());
  const [specFile, setSpecFile] = useState<File | null>(null);
  const [blueprintFile, setBlueprintFile] = useState<File | null>(null);
  const [override, setOverride] = useState({ template: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spec, setSpec] = useState<SpecView | null>(null);
  const [specs, setSpecs] = useState<SpecSummary[]>([]);
  const [aiUsed, setAiUsed] = useState(false);
  const [tab, setTab] = useState<Tab>("Overview");
  const [mapView, setMapView] = useState<"lattice" | "table">("lattice");

  useEffect(() => {
    call<{ status: string }>("/health")
      .then((d) => setHealth(d.status === "up" ? "connected" : d.status))
      .catch(() => setHealth("offline"));
  }, []);

  const refreshList = useCallback(() => {
    call<{ specs: SpecSummary[] }>("/specs").then((d) => setSpecs(d.specs)).catch(() => setSpecs([]));
  }, []);
  useEffect(refreshList, [refreshList, role]);

  function switchRole(next: Role) {
    setRole(next);
    saveRole(next);
    if (spec) call<SpecView>(`/specs/${spec.id}`).then(setSpec).catch(() => undefined);
  }

  async function generate() {
    if (!specFile) return setError("Choose the existing course specification first.");
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
      setSpec(await call<SpecView>(`/specs/${reply.spec_id}`));
      setTab("Overview");
      refreshList();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function editCell(co: string, column: string, level: 0 | 1 | 2 | 3, justification?: string) {
    if (!spec) return;
    setSpec(await call<SpecView>(`/specs/${spec.id}`, { method: "PATCH", body: JSON.stringify({ cells: [{ co, column, level, justification }] }) }));
  }

  async function transition(action: string, comment: string | null) {
    if (!spec) return;
    setSpec(await call<SpecView>(`/specs/${spec.id}/transition`, { method: "POST", body: JSON.stringify({ action, comment }) }));
    refreshList();
  }

  async function addComment(section: number | null, text: string) {
    if (!spec) return;
    await call(`/specs/${spec.id}/comments`, { method: "POST", body: JSON.stringify({ section, text }) });
    setSpec(await call<SpecView>(`/specs/${spec.id}`));
  }

  function download(name: string, text: string, type: string) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  const defects = useMemo(() => {
    const order = { High: 0, Medium: 1, Low: 2 } as const;
    return [...(spec?.defects ?? [])].sort((a, b) => order[a.severity] - order[b.severity]);
  }, [spec]);

  const mappedCells = spec ? Object.values(spec.output.co_po_pso_map).reduce((a, row) => a + Object.keys(row).length, 0) : 0;
  const weightTotal = spec ? spec.output.assessment.components.reduce((a, c) => a + c.weight_percent, 0) : 0;
  const highs = defects.filter((d) => d.severity === "High").length;

  const steps = [
    { label: "Upload inputs", done: Boolean(spec) || Boolean(specFile) },
    { label: "Correct and map", done: Boolean(spec) },
    { label: "Review and approve", done: spec !== null && spec.status !== "Draft" },
    { label: "Export", done: spec !== null && spec.status === "Approved" },
  ];
  const activeStep = steps.findIndex((s) => !s.done);

  return (
    <>
      <header className="bar">
        <div className="wordmark"><b>SpecForge</b> <span>Course specifications</span></div>
        <span className={`pill dot ${health === "connected" ? "sage" : "clay"}`}>{health}</span>
        {aiUsed && <span className="pill clay">AI assisted</span>}
        <div className="spacer" />
        <div className="segmented" role="group" aria-label="Role">
          {ROLES.map((r) => (
            <button key={r} aria-pressed={role === r} onClick={() => switchRole(r)}>{r}</button>
          ))}
        </div>
        <button className="ghost" onClick={() => setSettingsOpen(true)}>Settings</button>
      </header>

      {!spec && (
        <section className="hero">
          <Backdrop />
          <div className="veil" />
          <div className="inner">
            <p className="eyebrow">Accreditation-ready documents</p>
            <h1 className="display">Course specifications,<br />corrected and mapped.</h1>
            <p className="sub">
              Upload the messy specification and the question-paper blueprint. SpecForge rebuilds the official
              document, re-derives the CO-PO-PSO map from each outcome's Bloom level and the evidence in the
              syllabus, and reports every defect it can prove.
            </p>
            <div className="row" style={{ marginTop: 18 }}>
              <span className="pill">Blueprint decides the outcomes</span>
              <span className="pill">Rules, not guesswork</span>
              <span className="pill">Author · Reviewer · HOD</span>
            </div>
          </div>
        </section>
      )}

      <main>
        <div className="rail">
          {steps.map((step, i) => (
            <div key={step.label} className={`step ${step.done ? "done" : ""} ${i === activeStep ? "now" : ""}`}>
              <i>{step.done ? "✓" : i + 1}</i>
              {step.label}
            </div>
          ))}
        </div>

        {!spec && (
          <>
            <section className="card">
              <header>
                <h2>Upload the inputs</h2>
                <div className="spacer" />
                <span className="lede">.docx · .doc · .pdf · .html</span>
              </header>
              <div className="grid two">
                <label className={`drop ${specFile ? "filled" : ""}`}>
                  <span className="title">Existing course specification</span>
                  <span className="lede"> — required, source for every section except the outcomes</span>
                  <input type="file" accept=".docx,.doc,.pdf,.html,.htm" onChange={(e) => setSpecFile(e.target.files?.[0] ?? null)} />
                  <div className="name">{specFile ? specFile.name : "Drop a file or click to choose"}</div>
                </label>
                <label className={`drop ${blueprintFile ? "filled" : ""}`}>
                  <span className="title">Question-paper blueprint</span>
                  <span className="lede"> — optional, decides the outcomes and units</span>
                  <input type="file" accept=".docx,.doc,.pdf,.html,.htm" onChange={(e) => setBlueprintFile(e.target.files?.[0] ?? null)} />
                  <div className="name">{blueprintFile ? blueprintFile.name : "Drop a file or click to choose"}</div>
                </label>
              </div>
              <div className="grid two" style={{ marginTop: 14 }}>
                <label>
                  Template
                  <select value={override.template} onChange={(e) => setOverride({ ...override, template: e.target.value })}>
                    <option value="">Detect from the credit structure</option>
                    <option value="integrated">Force Integrated</option>
                    <option value="non_lab">Force Non-Lab</option>
                  </select>
                </label>
                <label>
                  Reason for the override
                  <input type="text" value={override.reason} disabled={!override.template} onChange={(e) => setOverride({ ...override, reason: e.target.value })} placeholder={override.template ? "Required" : "Only needed when you override"} />
                </label>
              </div>
              <div className="row">
                <button onClick={generate} disabled={busy || role !== "Author" || !specFile}>
                  {busy ? "Correcting…" : "Generate corrected spec"}
                </button>
                {role !== "Author" && <span className="lede">Switch to Author to run a generation.</span>}
                {error && <span className="bad">{error}</span>}
              </div>
            </section>

            <section className="card">
              <header>
                <h2>Specifications</h2>
                <span className="pill">{specs.length}</span>
              </header>
              {specs.length === 0 ? (
                <p className="empty">Nothing generated yet. Upload a specification to begin.</p>
              ) : (
                <div className="scroll">
                  <table>
                    <thead><tr><th>Code</th><th>Title</th><th>Status</th><th className="center">Defects</th><th>Updated</th><th /></tr></thead>
                    <tbody>
                      {specs.map((s) => (
                        <tr key={s.id}>
                          <td className="mono">{s.code}</td>
                          <td>{s.title}</td>
                          <td><span className="pill ink">{s.status}</span></td>
                          <td className="center">{s.defects}</td>
                          <td className="muted">{new Date(s.updatedAt).toLocaleTimeString()}</td>
                          <td><button className="link" onClick={() => call<SpecView>(`/specs/${s.id}`).then(setSpec)}>Open</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {spec && (
          <>
            <section className="card">
              <header>
                <div>
                  <h2>{spec.output.course.title}</h2>
                  <span className="lede mono">{spec.output.course.code} · {spec.output.course.department}</span>
                </div>
                <div className="spacer" />
                <span className={`pill ${spec.status === "Approved" ? "sage" : spec.status === "Returned" ? "clay" : "ink"}`}>{spec.status}</span>
                <button className="ghost" onClick={() => { setSpec(null); refreshList(); }}>All specs</button>
              </header>

              <div className="grid four">
                <div className="tile accent">
                  <div className="k">Defects found</div>
                  <div className="v">{defects.length}</div>
                  <div className="d">{highs} high · {defects.length - highs} other</div>
                </div>
                <div className="tile">
                  <div className="k">Mapped cells</div>
                  <div className="v">{mappedCells}</div>
                  <div className="d">{spec.output.course_outcomes.length} outcomes × 13 columns</div>
                </div>
                <div className="tile">
                  <div className="k">Teaching hours</div>
                  <div className="v">{spec.output.teaching_hours.total}</div>
                  <div className="d">{spec.output.teaching_hours.lectures} lecture · {spec.output.teaching_hours.lab} lab</div>
                </div>
                <div className="tile">
                  <div className="k">Weightage</div>
                  <div className="v">{Math.round(weightTotal)}%</div>
                  <div className="d">{spec.output.assessment.components.length} components</div>
                </div>
              </div>

              <div className="row" style={{ marginTop: 16 }}>
                <span className="pill ink">{TEMPLATE_LABEL[spec.output.template]}</span>
                <span className="pill">Credits {spec.output.course.credits_ltp}</span>
                <span className="pill">input_id {spec.output.input_id}</span>
                <div className="spacer" />
                <button className="ghost" onClick={() => download("specforge_output.json", JSON.stringify(spec.output, null, 2), "application/json")}>Output JSON</button>
                <button className="ghost" onClick={() => window.open(`/api/v1/specs/${spec.id}/spec.html`, "_blank")}>Open spec.html</button>
                <button className="ghost" onClick={() => window.open(`/api/v1/specs/${spec.id}/report.html`, "_blank")}>Validation report</button>
              </div>
            </section>

            <div className="tabs" role="tablist">
              {TABS.map((name) => (
                <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>
                  {name}
                  {name === "Defects" && <span className="count">{defects.length}</span>}
                  {name === "Map" && <span className="count">{mappedCells}</span>}
                </button>
              ))}
            </div>

            {tab === "Overview" && (
              <>
                <section className="card">
                  <header><h2>Summary</h2><div className="spacer" /><span className="lede">rewritten to cover every unit</span></header>
                  <p>{spec.output.course.summary}</p>
                  <div className="row" style={{ marginTop: 12 }}>
                    {spec.signals.map((s, i) => <span key={i} className="pill">{s}</span>)}
                  </div>
                </section>

                <section className="card">
                  <header>
                    <h2>Course outcomes</h2>
                    <span className="pill">{spec.output.course_outcomes.length}</span>
                    <div className="spacer" />
                    <span className="lede">Bloom level from the leading verb</span>
                  </header>
                  <ul className="colist">
                    {spec.output.course_outcomes.map((co) => (
                      <li key={co.id}>
                        <div className="row" style={{ marginBottom: 6 }}>
                          <strong className="mono">{co.id}</strong>
                          <span className="pill clay">L{co.bloom_level} {BLOOM_NAMES[co.bloom_level]}</span>
                          <span className="pill">{(spec.output.assessment.co_coverage[co.id] ?? []).join(" · ")}</span>
                        </div>
                        {co.statement}
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="card">
                  <header><h2>Units</h2><span className="pill">{spec.output.units.length}</span></header>
                  <div className="scroll">
                    <table>
                      <thead><tr><th className="center">Unit</th><th>Title</th><th>Lab exercises</th></tr></thead>
                      <tbody>
                        {spec.output.units.map((u) => (
                          <tr key={u.number}>
                            <td className="center mono">{u.number}</td>
                            <td>{u.title}</td>
                            <td className="muted">{u.lab ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}

            {tab === "Map" && (
              <>
                <section className="card">
                  <header>
                    <h2>CO-PO-PSO map</h2>
                    <span className="pill">{mappedCells} cells</span>
                    <div className="spacer" />
                    <div className="segmented">
                      <button aria-pressed={mapView === "lattice"} onClick={() => setMapView("lattice")}>Lattice</button>
                      <button aria-pressed={mapView === "table"} onClick={() => setMapView("table")}>Table</button>
                    </div>
                  </header>
                  {mapView === "lattice" ? (
                    <>
                      <MapLattice output={spec.output} />
                      <div className="legend">
                        <span><i style={{ background: "#c15f3c" }} />3 very strong</span>
                        <span><i style={{ background: "#d08a63" }} />2 strong</span>
                        <span><i style={{ background: "#e0c3b2" }} />1 moderate</span>
                        <span><i style={{ background: "#f6f4ec" }} />blank: no evidence</span>
                      </div>
                    </>
                  ) : (
                    <p className="lede">Switch to the table to edit cells.</p>
                  )}
                </section>
                {mapView === "table" && <MapTable output={spec.output} canEdit={spec.canEdit} onEdit={editCell} />}
              </>
            )}

            {tab === "Defects" && (
              <section className="card">
                <header>
                  <h2>Validation report</h2>
                  <span className="pill clay">{highs} high</span>
                  <span className="pill amber">{defects.filter((d) => d.severity === "Medium").length} medium</span>
                  <span className="pill">{defects.filter((d) => d.severity === "Low").length} low</span>
                  <div className="spacer" />
                  <span className="lede">only problems a rule can prove</span>
                </header>
                {defects.length === 0 ? (
                  <p className="empty">No defects found in these inputs.</p>
                ) : (
                  defects.map((d, i) => (
                    <div key={i} className={`defect ${d.severity}`}>
                      <div className="row" style={{ marginBottom: 6 }}>
                        <span className={`pill dot ${d.severity === "High" ? "clay" : d.severity === "Medium" ? "amber" : ""}`}>{d.severity}</span>
                        <code>{d.code}</code>
                        <span className="pill">{d.location.source}{d.location.section ? ` · section ${d.location.section}` : ""}</span>
                        {d.location.refs.length > 0 && <span className="pill ink">{d.location.refs.join(", ")}</span>}
                        {d.rule && <span className="pill">{d.rule}</span>}
                      </div>
                      <p style={{ margin: "0 0 4px" }}>{d.description}</p>
                      <p className="fix">Fix applied: {d.fix}</p>
                    </div>
                  ))
                )}
                {spec.notes.length > 0 && (
                  <>
                    <h3 style={{ marginTop: 16 }}>Decisions and conflicts</h3>
                    <ul className="log">{spec.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                  </>
                )}
              </section>
            )}

            {tab === "Document" && (
              <section className="card">
                <header>
                  <h2>Document preview</h2>
                  <div className="spacer" />
                  <span className="lede">{spec.status === "Approved" ? "Approved — no watermark" : "DRAFT watermark until approval"}</span>
                </header>
                <iframe className="preview" title="spec preview" src={`/api/v1/specs/${spec.id}/spec.html`} />
                <div className="timeline" style={{ marginTop: 14 }}>
                  {WORKFLOW.map((state) => (
                    <span key={state} className={`step ${state === spec.status ? "now" : ""}`}>{state}</span>
                  ))}
                </div>
              </section>
            )}

            {tab === "Workflow" && <Workflow spec={spec} role={role} onTransition={transition} onComment={addComment} />}
          </>
        )}
      </main>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
