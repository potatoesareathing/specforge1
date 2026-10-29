// The downloadable validation report: every defect grouped by severity.
import type { Defect } from "./validate.js";
import type { SpecForgeOutput } from "./output.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function validationReportHtml(output: SpecForgeOutput, defects: Defect[], notes: string[], signals: string[]): string {
  const groups: Defect["severity"][] = ["High", "Medium", "Low"];
  const rows = groups
    .map((severity) => {
      const items = defects.filter((d) => d.severity === severity);
      if (!items.length) return "";
      const lines = items
        .map(
          (d) => `<tr>
  <td class="code">${esc(d.code)}</td>
  <td>${d.location.source}${d.location.section ? ` &middot; section ${d.location.section}` : ""}${d.location.refs.length ? ` &middot; ${esc(d.location.refs.join(", "))}` : ""}</td>
  <td>${esc(d.description)}</td>
  <td>${esc(d.fix)}</td>
  <td>${esc(d.rule ?? "rule")}</td>
</tr>`,
        )
        .join("\n");
      return `<h2>${severity} (${items.length})</h2>
<table><thead><tr><th>Code</th><th>Where</th><th>Problem</th><th>Value chosen / fix</th><th>Check</th></tr></thead><tbody>${lines}</tbody></table>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Validation report ${esc(output.course.code)}</title>
<style>
  :root { color-scheme: light; }
  body { font: 15px/1.6 Georgia, "Times New Roman", serif; margin: 0; padding: 40px; background: #f0eee6; color: #141413; }
  main { max-width: 980px; margin: 0 auto; background: #fff; border: 1px solid #ddd8cc; border-radius: 12px; padding: 32px; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  p.lede { margin: 0 0 24px; color: #5c5a52; }
  h2 { font-size: 17px; margin: 28px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-family: system-ui, sans-serif; font-size: 13px; }
  th, td { border: 1px solid #e2ded2; padding: 8px 10px; text-align: left; vertical-align: top; }
  th { background: #f6f4ec; }
  td.code { font-family: ui-monospace, monospace; font-size: 12px; white-space: nowrap; }
  ul { font-family: system-ui, sans-serif; font-size: 13px; color: #4a4840; }
</style></head>
<body><main>
<h1>Validation report</h1>
<p class="lede">${esc(output.course.code)} &middot; ${esc(output.course.title)} &middot; ${output.template === "integrated" ? "Integrated (theory + lab)" : "Non-Lab"} template &middot; ${defects.length} finding${defects.length === 1 ? "" : "s"}</p>
<h2>Template decision</h2>
<ul>${signals.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
${rows || "<p>No defects were found in the inputs.</p>"}
<h2>Conflicts and decisions</h2>
<ul>${notes.length ? notes.map((n) => `<li>${esc(n)}</li>`).join("") : "<li>No conflicts were recorded.</li>"}</ul>
</main></body></html>`;
}
