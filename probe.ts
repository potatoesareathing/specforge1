import { readFileSync, writeFileSync } from "node:fs";
import { generateSpec } from "./server/pipeline.js";
const r = await generateSpec({
  spec: { buffer: readFileSync("sample-inputs/sample_course_spec.docx"), name: "sample_course_spec.docx" },
  blueprint: { buffer: readFileSync("sample-inputs/sample_blueprint.doc"), name: "sample_blueprint.doc" },
});
writeFileSync("outputs/specforge_output.json", JSON.stringify(r.output, null, 2));
writeFileSync("outputs/spec.html", r.html);
console.log("template", r.output.template, "| input_id", r.output.input_id, "| signals", r.signals.join(" ; "));
console.log("hours", r.output.teaching_hours, "components", r.output.assessment.components);
console.log("summary:", r.output.course.summary.slice(0, 200));
console.log("COs", r.output.course_outcomes.map((c) => `${c.id}=L${c.bloom_level}`).join(" "));
for (const [co, row] of Object.entries(r.output.co_po_pso_map)) {
  console.log(co, Object.entries(row).map(([k, v]) => `${k}:${v.level}`).join(" "));
}
console.log("DEFECTS", r.defects.length);
for (const d of r.defects) console.log(` - ${d.code} s${d.location.section} [${d.location.refs.join(",")}] ${d.description}`);
