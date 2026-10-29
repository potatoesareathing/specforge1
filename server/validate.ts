// Rule-based validation (V1 to V10). Plain code, no AI: every defect here is
// something the checks below can prove from the uploaded documents.
import { PSOS } from "./bloom.js";
import type { CoPoMap, CoInput, Evidence } from "./mapping.js";
import type { ExtractedSpec, UnitRow } from "./extract.js";

export type DefectCode =
  | "CO_MISSING_IN_TABLE"
  | "CO_EXTRA_IN_TABLE"
  | "CO_ASSESSMENT_MISMATCH"
  | "PSO_COLUMN_MISMATCH"
  | "MAPPING_BLOOM_MISMATCH"
  | "MAPPING_UNSUPPORTED"
  | "WRONG_TEMPLATE"
  | "PLACEHOLDER_TEXT"
  | "SUMMARY_SYLLABUS_MISMATCH"
  | "LABEL_OR_TITLE_MISMATCH"
  | "HOURS_INCONSISTENT"
  | "WEIGHTAGE_INCONSISTENT"
  | "TYPO_OR_FORMAT"
  | "SECTION_NOT_IN_TEMPLATE"
  | "MARKS_INCONSISTENT"
  | "OTHER";

export type Defect = {
  code: DefectCode;
  location: { source: "spec" | "blueprint" | "template"; section: number | null; refs: string[] };
  description: string;
  fix: string;
  severity: "High" | "Medium" | "Low";
  rule?: string;
};

export type ValidationInput = {
  spec: ExtractedSpec;
  blueprint: { cos: { id: string; statement: string }[]; units: UnitRow[]; header: Record<string, string>; maxMarks: number | null; totalMarks: number | null } | null;
  cos: CoInput[];
  units: UnitRow[];
  map: CoPoMap;
  hours: { lectures: number; lab: number; tests_exams: number; total: number };
  components: { name: string; weight: number }[];
  coverage: Record<string, string[]>;
  template: "integrated" | "non_lab";
  templateSignals: string[];
  blueprintText?: string;
  placeholders: string[];
  evidence: Evidence;
  clampNotes: string[];
};

const defect = (
  code: DefectCode,
  source: Defect["location"]["source"],
  section: number | null,
  refs: string[],
  description: string,
  fix: string,
  severity: Defect["severity"],
  rule?: string,
): Defect => ({ code, location: { source, section, refs }, description, fix, severity, rule });

const idNum = (id: string) => Number(id.replace(/\D/g, ""));

/** Words worth matching between a summary and a unit title. */
function keywords(text: string): string[] {
  const stop = new Set([
    "and", "the", "for", "with", "using", "their", "other", "into", "from", "that", "this", "are", "its",
    "introduction", "basic", "elements", "concept", "concepts", "building", "blocks", "problem", "solving",
  ]);
  return [...new Set(text.toLowerCase().match(/[a-z]{4,}/g) ?? [])].filter((w) => !stop.has(w));
}

/** Publishers that appear in academic reading lists. Reference data, not course content. */
const PUBLISHERS = [
  "O'Reilly", "Pearson", "Springer", "Wiley", "Cengage", "McGraw-Hill", "Elsevier", "Prentice Hall",
  "Oxford", "Cambridge", "Packt", "Apress", "Morgan Kaufmann", "Routledge", "Penguin", "Addison-Wesley", "Academic Press",
];

function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_v, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    }
  }
  return rows[a.length][b.length];
}

/** Words in the text that are one or two letters away from a publisher's name. */
function misspeltPublishers(text: string): { wrong: string; right: string }[] {
  const found = new Map<string, string>();
  const words = text.match(/[A-Z][A-Za-z'’\-]{4,}/g) ?? [];
  for (const raw of words) {
    const word = raw.replace(/[’]/g, "'");
    if (PUBLISHERS.some((p) => p.toLowerCase() === word.toLowerCase())) continue;
    for (const publisher of PUBLISHERS) {
      if (Math.abs(publisher.length - word.length) > 2) continue;
      const d = distance(word, publisher);
      if (d >= 1 && d <= 2 && word.length >= 6) {
        found.set(word, publisher);
        break;
      }
    }
  }
  return [...found.entries()].map(([wrong, right]) => ({ wrong, right }));
}

export function runValidation(input: ValidationInput): Defect[] {
  const out: Defect[] = [];
  const { spec, blueprint, cos, units, map, hours, components, coverage, template } = input;
  const definedIds = new Set(cos.map((c) => c.id));

  // V1 / V4: the CO set in the spec's own tables against the defined COs.
  const mapRowIds = new Set(spec.map.rows.map((r) => r.co));
  for (const co of cos) {
    if (spec.map.rows.length && !mapRowIds.has(co.id)) {
      out.push(
        defect("CO_MISSING_IN_TABLE", "spec", 5, [co.id], `${co.id} is defined in Section 3 but has no row in the CO-PO-PSO map.`, `Added a mapped row for ${co.id} in Section 5.`, "High", "V1"),
      );
    }
  }
  for (const row of spec.map.rows) {
    if (!definedIds.has(row.co)) {
      out.push(
        defect("CO_EXTRA_IN_TABLE", "spec", 5, [row.co], `${row.co} appears in the CO-PO-PSO map but is not defined in Section 3.`, `Removed the ${row.co} row from Section 5.`, "High", "V4"),
      );
    }
  }

  const assessedIds = new Set(spec.assessment.leaves.flatMap((l) => l.cos));
  for (const id of assessedIds) {
    if (!definedIds.has(id)) {
      out.push(
        defect("CO_EXTRA_IN_TABLE", "spec", 7, [id], `${id} is assessed in Section 7 but is not defined in Section 3.`, `Removed ${id} from the assessment table and kept only the defined outcomes.`, "High", "V4"),
      );
    }
  }
  for (const co of cos) {
    if (spec.assessment.leaves.length && !assessedIds.has(co.id)) {
      out.push(
        defect("CO_ASSESSMENT_MISMATCH", "spec", 7, [co.id], `${co.id} is not assessed in any component of Section 7.`, `${co.id} is now assessed in ${(coverage[co.id] ?? []).join(", ") || "the continuous evaluation components"}.`, "High", "V3"),
      );
    }
  }

  // V8: the PSO columns the programme actually has.
  const allowed = new Set(PSOS.map((p) => p.id));
  for (const col of spec.map.columns) {
    if (col.startsWith("PSO-") && !allowed.has(col)) {
      out.push(
        defect("PSO_COLUMN_MISMATCH", "spec", 5, [col], `The map carries a ${col} column, but the programme defines only ${PSOS.map((p) => p.id).join(" and ")}.`, `Dropped the ${col} column from Section 5.`, "High", "V8"),
      );
    }
  }

  // V9: the mapping values already in the spec, against the Bloom ceiling and the evidence.
  const bloomOf = new Map(cos.map((c) => [c.id, c.bloom]));
  for (const row of spec.map.rows) {
    const bloom = bloomOf.get(row.co);
    if (!bloom) continue;
    for (const [col, level] of Object.entries(row.cells)) {
      if (!level) continue;
      const corrected: number = map[row.co]?.[col]?.level ?? 0;
      if (!allowed.has(col) && col.startsWith("PSO-")) continue;
      if (corrected === 0) {
        out.push(
          defect("MAPPING_UNSUPPORTED", "spec", 5, [row.co, col], `${row.co} is mapped ${level} to ${col}, but the syllabus and assessment show no evidence for it.`, `Left ${row.co}/${col} blank in the corrected map.`, "Medium", "V9"),
        );
      } else if (level > corrected) {
        out.push(
          defect("MAPPING_BLOOM_MISMATCH", "spec", 5, [row.co, col], `${row.co} is an L${bloom} outcome mapped ${level} to ${col}, which is stronger than its cognitive level supports.`, `Reduced ${row.co}/${col} to ${corrected}.`, "Medium", "V9"),
        );
      }
    }
  }

  // V5: hours.
  const sum = hours.lectures + hours.lab + hours.tests_exams;
  if (spec.hours.statedTotal !== null && spec.hours.statedTotal !== sum) {
    out.push(
      defect("HOURS_INCONSISTENT", "spec", 6, [], `The teaching-hours rows add up to ${sum}, but the table states a total of ${spec.hours.statedTotal}.`, `Recomputed the total as ${sum} hours.`, "High", "V5"),
    );
  }
  if (spec.credits.totalHours !== null && spec.credits.totalHours !== sum) {
    out.push(
      defect("HOURS_INCONSISTENT", "spec", 2, [], `Section 2 states ${spec.credits.totalHours} total hours of interaction, while Section 6 adds up to ${sum}.`, `Kept the Section 6 breakdown (${sum} hours) and flagged the Section 2 figure.`, "Medium", "V5"),
    );
  }
  const unitHours = units.reduce((a, u) => a + (u.hours ?? 0), 0);
  if (unitHours > 0 && hours.lectures > 0 && unitHours !== hours.lectures) {
    out.push(
      defect("HOURS_INCONSISTENT", blueprint ? "blueprint" : "spec", 4, units.map((u) => `Unit-${u.number}`), `The unit-wise hours add up to ${unitHours}, which does not match the ${hours.lectures} lecture hours in Section 6.`, `Reported the difference; the Section 6 lecture total was kept.`, "Medium", "V5"),
    );
  }

  // V6: weightages.
  const weight = components.reduce((a, c) => a + c.weight, 0);
  if (components.length && Math.round(weight) !== 100) {
    out.push(
      defect("WEIGHTAGE_INCONSISTENT", "spec", 7, components.map((c) => c.name), `The assessment weightages add up to ${weight}%, not 100%.`, `Normalised the components so the weightages total 100%.`, "High", "V6"),
    );
  }

  // Marks consistency inside the blueprint.
  if (blueprint) {
    const unitMarks = blueprint.units.reduce((a, u) => a + (u.marks ?? 0), 0);
    if (blueprint.maxMarks !== null && blueprint.totalMarks !== null && blueprint.maxMarks !== blueprint.totalMarks) {
      out.push(
        defect("MARKS_INCONSISTENT", "blueprint", null, [], `The blueprint states maximum marks of ${blueprint.maxMarks} but its unit-wise table totals ${blueprint.totalMarks}.`, `Used the examination maximum of ${blueprint.maxMarks} and reported the mismatch.`, "Medium"),
      );
    } else if (blueprint.maxMarks !== null && unitMarks > 0 && unitMarks !== blueprint.maxMarks) {
      out.push(
        defect("MARKS_INCONSISTENT", "blueprint", null, [], `The blueprint's unit marks add up to ${unitMarks} against a stated maximum of ${blueprint.maxMarks}.`, `Reported the mismatch; the stated maximum was kept.`, "Medium"),
      );
    }
    // Code and title must agree between the two sources.
    const bpCode = blueprint.header.code;
    const bpTitle = blueprint.header.title;
    if (bpCode && spec.header.code && bpCode.toLowerCase() !== spec.header.code.toLowerCase()) {
      out.push(
        defect("LABEL_OR_TITLE_MISMATCH", "spec", null, [], `The course code differs between the sources: "${spec.header.code}" in the spec and "${bpCode}" in the blueprint.`, `Kept the spec's code and reported the conflict.`, "High"),
      );
    }
    if (bpTitle && spec.header.title && bpTitle.toLowerCase() !== spec.header.title.toLowerCase()) {
      out.push(
        defect("LABEL_OR_TITLE_MISMATCH", "spec", null, [], `The course title differs between the sources: "${spec.header.title}" in the spec and "${bpTitle}" in the blueprint.`, `Kept the spec's title and reported the conflict.`, "Medium"),
      );
    }
    // CO statements that drifted from the blueprint, which is the source of truth.
    for (const bpCo of blueprint.cos) {
      const specCo = spec.cos.find((c) => c.id === bpCo.id);
      if (specCo && specCo.statement.replace(/\W+/g, " ").trim().toLowerCase() !== bpCo.statement.replace(/\W+/g, " ").trim().toLowerCase()) {
        out.push(
          defect("LABEL_OR_TITLE_MISMATCH", "spec", 3, [bpCo.id], `${bpCo.id} is worded differently in the spec and in the blueprint.`, `Took the blueprint wording for ${bpCo.id}.`, "Low"),
        );
      }
    }
    if (blueprint.cos.length && spec.cos.length && blueprint.cos.length !== spec.cos.length) {
      out.push(
        defect("CO_MISSING_IN_TABLE", "spec", 3, [], `The spec lists ${spec.cos.length} course outcomes and the blueprint lists ${blueprint.cos.length}.`, `Used the blueprint's ${blueprint.cos.length} outcomes.`, "High", "V1"),
      );
    }
  }

  // V10 / template choice.
  if (template === "integrated" && !input.evidence.practical) {
    out.push(
      defect("WRONG_TEMPLATE", "template", null, [], `The credit structure marks this as a lab course, but no lab exercises were found in the syllabus.`, `Used the Integrated template and reported the missing lab content.`, "Medium", "V10"),
    );
  }
  if (template === "non_lab" && input.evidence.practical) {
    out.push(
      defect("WRONG_TEMPLATE", "template", null, [], `Lab exercises appear in the syllabus although the credit structure has no practical component.`, `Used the Non-Lab template as the credit rule requires and reported the lab content.`, "Medium", "V10"),
    );
  }

  // V7: sample text from the blank template.
  const haystack = `${spec.text} ${spec.summary}`.toLowerCase();
  for (const sample of input.placeholders) {
    if (sample.length < 6) continue;
    if (haystack.includes(sample.toLowerCase())) {
      out.push(
        defect("PLACEHOLDER_TEXT", "template", null, [], `The uploaded spec still carries template sample text: "${sample.slice(0, 60)}".`, `Replaced it with this course's own content.`, "High", "V7"),
      );
    }
  }
  for (const marker of spec.text.match(/\b(TBD|TODO|XXXX?|lorem ipsum|<insert[^>]*>)\b/gi) ?? []) {
    out.push(
      defect("PLACEHOLDER_TEXT", "spec", null, [], `The spec contains the placeholder "${marker}".`, `Removed the placeholder and filled in the real value.`, "Medium", "V7"),
    );
  }

  // Sections the official template has no place for.
  for (const extra of spec.extraSections) {
    out.push(
      defect("SECTION_NOT_IN_TEMPLATE", "spec", null, [], `The spec has a "${extra}" section, which the official template does not contain.`, `Left it out of the document body and reported it here.`, "Low"),
    );
  }

  // Summary against the syllabus themes.
  const summaryWords = new Set(keywords(spec.summary));
  const missing = units.filter((u) => {
    const words = keywords(u.title);
    return words.length > 0 && !words.some((w) => summaryWords.has(w));
  });
  if (spec.summary && missing.length) {
    out.push(
      defect(
        "SUMMARY_SYLLABUS_MISMATCH",
        "spec",
        1,
        missing.map((u) => `Unit-${u.number}`),
        `The course summary does not mention ${missing.map((u) => `"${u.title}"`).join(", ")}.`,
        `Rewrote the summary so it covers every unit theme.`,
        "Medium",
      ),
    );
  }

  // Misspelled publisher names in the reading list, found by comparing against
  // the reference list of publishers rather than against any course content.
  for (const { wrong, right } of misspeltPublishers(spec.text)) {
    out.push(
      defect("TYPO_OR_FORMAT", "spec", 9, [], `The reading list spells a publisher as "${wrong}" instead of "${right}".`, `Corrected it to "${right}".`, "Low"),
    );
  }

  // Typos and broken references that a rule can prove.
  // A space inside the host of a URL is always a typo; a space after the URL is just the next word.
  for (const url of spec.text.match(/https?:\/\/[^\s/]+\s+[^\s/]+\//g) ?? []) {
    out.push(
      defect("TYPO_OR_FORMAT", "spec", 9, [], `A reference URL is broken by a space inside the address: "${url.replace(/\s+/g, " ").slice(0, 60)}".`, `Closed the gap in the URL.`, "Low"),
    );
  }
  for (const label of spec.text.match(/\bAchieving Cos\b|\bCo'?s\b(?!\w)/g) ?? []) {
    out.push(
      defect("LABEL_OR_TITLE_MISMATCH", "spec", 8, [], `The heading "${label}" uses the wrong capitalisation for "COs".`, `Used the template heading "Achieving COs".`, "Low"),
    );
  }
  // Anything the clamp step had to change is worth reporting once.
  for (const note of input.clampNotes.slice(0, 6)) {
    if (!/removed|reduced/.test(note)) continue;
    const refs = note.split(/[\s/]/).filter((t) => /^(CO|PO|PSO)-\d+$/.test(t));
    if (out.some((d) => d.location.refs.join() === refs.join() && d.code.startsWith("MAPPING"))) continue;
    out.push(defect("MAPPING_UNSUPPORTED", "spec", 5, refs, note, "Applied the mapping rules to that cell.", "Low", "V9"));
  }

  // One entry per real problem.
  const seen = new Set<string>();
  return out.filter((d) => {
    const key = `${d.code}|${d.location.section}|${d.location.refs.join(",")}|${d.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => idNum(a.location.refs[0] ?? "0") - idNum(b.location.refs[0] ?? "0"));
}
