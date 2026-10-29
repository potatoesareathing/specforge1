// The whole correction run: read the documents, merge the sources, re-derive the map,
// validate, then build the scoring file and the filled spec document.
// The AI is used for judgement calls only; every step has a rule-based fallback.
import { z } from "zod";
import { readDocument } from "./docs.js";
import {
  extractSpec,
  extractCos,
  extractHeader,
  extractUnitsFromBlueprint,
  groupResources,
  norm,
  type ExtractedSpec,
  type UnitRow,
} from "./extract.js";
import { bloomFromStatement, POS, PSOS } from "./bloom.js";
import { buildMap, clampMap, type CoInput, type CoPoMap, type Evidence } from "./mapping.js";
import { runValidation, type Defect } from "./validate.js";
import { outputSchema, type SpecForgeOutput } from "./output.js";
import { renderSpec, templatePlaceholders, type TemplateName } from "./render.js";
import { generateJson, type LlmConfig } from "./llm.js";

export type GenerateResult = {
  output: SpecForgeOutput;
  html: string;
  defects: Defect[];
  signals: string[];
  notes: string[];
  aiUsed: boolean;
  render: {
    units: { number: number; title: string; content: string; lab: string | null }[];
    credits: { number: string | null; weeks: string | null; marks: number | null; faculty: string | null };
    resources: Record<string, string[]>;
  };
};

export type GenerateOptions = {
  spec: { buffer: Buffer; name: string };
  blueprint?: { buffer: Buffer; name: string } | null;
  llm?: LlmConfig | null;
  templateOverride?: { template: TemplateName; reason: string } | null;
  status?: string;
};

const number = (v: number | null | undefined, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Template rule: a practical credit or a "laboratory" course type means Integrated. */
export function chooseTemplate(ltp: string | null, courseType: string | null, labText: string) {
  const signals: string[] = [];
  const practical = ltp ? Number(ltp.split(":")[2] ?? 0) : 0;
  if (ltp) signals.push(`credit structure ${ltp} (practical = ${practical})`);
  if (courseType) signals.push(`course type "${courseType}"`);
  const typeSaysLab = /laborator|\blab\b|practical/i.test(courseType ?? "");
  if (typeSaysLab) signals.push("course type mentions a laboratory");
  if (labText) signals.push("the syllabus contains lab exercises");
  const template: TemplateName = practical > 0 || typeSaysLab ? "integrated" : "non_lab";
  return { template, signals };
}

/** The ID printed on the input pack, or SAMPLE for the sample kit. */
function inputId(text: string, names: string[]): string {
  const printed = text.match(/\b(?:input|pack)\s*(?:id|code)\s*[:#-]?\s*([A-Z][A-Z0-9-]{0,15})\b/i);
  if (printed) return printed[1].toUpperCase();
  const tagged = names.find((n) => /^[A-Z]\d+[_-]/.test(n));
  if (tagged) return tagged.split(/[_-]/)[0].toUpperCase();
  return "SAMPLE";
}

/** A summary that names every unit theme, used when the AI is unavailable. */
function summaryFallback(existing: string, units: UnitRow[]): string {
  const themes = units.map((u) => u.title).filter(Boolean);
  if (!themes.length) return existing;
  const base = existing ? existing.replace(/\s*$/, " ") : "";
  return norm(`${base}The course covers ${themes.slice(0, -1).join(", ")}${themes.length > 1 ? " and " : ""}${themes[themes.length - 1]}.`);
}

const aiSchema = z.object({
  summary: z.string().min(40),
  outcomes: z
    .array(z.object({ id: z.string(), bloom_level: z.number().int().min(1).max(6) }))
    .optional()
    .default([]),
  map: z
    .array(
      z.object({
        co: z.string(),
        column: z.string(),
        level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
        justification: z.string().min(8),
      }),
    )
    .optional()
    .default([]),
});

function aiPrompt(cos: CoInput[], units: UnitRow[], map: CoPoMap, ev: Evidence, summary: string): string {
  const rules = [
    "Scale: 3 very strong, 2 strong, 1 moderate, 0 blank. No other values.",
    "A CO cannot map more strongly to a PO than its Bloom level supports.",
    "PO-5 needs real tool use. PO-6 to PO-10 need explicit evidence in the syllabus or assessment, otherwise 0.",
    "Every CO keeps at least one PO. Each filled cell needs a one-line justification.",
  ];
  return [
    "You are reviewing a university course specification mapping.",
    `Programme outcomes: ${POS.map((p) => `${p.id} = ${p.title}`).join("; ")}.`,
    `Programme specific outcomes: ${PSOS.map((p) => `${p.id} = ${p.statement}`).join(" ")}`,
    `Rules: ${rules.join(" ")}`,
    `Course outcomes: ${JSON.stringify(cos.map((c) => ({ id: c.id, statement: c.statement, bloom: c.bloom })))}`,
    `Units: ${JSON.stringify(units.map((u) => ({ number: u.number, title: u.title, content: u.content.slice(0, 400), lab: u.lab })))}`,
    `Assessment components: ${ev.components.join(", ") || "none listed"}. Lab course: ${ev.integrated}.`,
    `Current draft map (rule based): ${JSON.stringify(
      Object.fromEntries(Object.entries(map).map(([co, row]) => [co, Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v.level]))])),
    )}`,
    `Current summary: ${summary}`,
    "Reply with JSON: { summary: a rewritten course summary that covers every unit theme in 90 to 140 words,",
    "outcomes: [{ id, bloom_level }] for every CO,",
    "map: [{ co, column, level, justification }] for every cell you would change or justify better (level 0 means leave it blank) }.",
  ].join("\n");
}

export async function generateSpec(options: GenerateOptions): Promise<GenerateResult> {
  const notes: string[] = [];
  const specDoc = await readDocument(options.spec.buffer, options.spec.name);
  const spec: ExtractedSpec = extractSpec(specDoc);

  let blueprint: GenerateResult extends never ? never : Parameters<typeof runValidation>[0]["blueprint"] = null;
  let bpUnits: UnitRow[] = [];
  let bpCos: { id: string; statement: string }[] = [];
  let blueprintText = "";
  if (options.blueprint?.buffer?.length) {
    const bpDoc = await readDocument(options.blueprint.buffer, options.blueprint.name);
    blueprintText = bpDoc.text;
    bpCos = extractCos(bpDoc);
    bpUnits = extractUnitsFromBlueprint(bpDoc);
    const header = extractHeader(bpDoc).header;
    const maxMarks = bpDoc.text.match(/maximum marks\s*:?\s*(\d{1,3})/i);
    const totalMarks = bpDoc.text.match(/total marks\s*:?\s*(\d{1,3})/i);
    blueprint = {
      cos: bpCos,
      units: bpUnits,
      header,
      maxMarks: maxMarks ? Number(maxMarks[1]) : null,
      totalMarks: totalMarks ? Number(totalMarks[1]) : null,
    };
  } else {
    notes.push("No blueprint supplied: course outcomes and units were taken from the existing specification.");
  }

  // Course outcomes and units come from the blueprint when there is one.
  const coSource = bpCos.length ? bpCos : spec.cos;
  const unitSource = bpUnits.length ? bpUnits : spec.units;
  const units: UnitRow[] = unitSource.map((u) => {
    const fromSpec = spec.units.find((s) => s.number === u.number);
    return { ...u, lab: u.lab ?? fromSpec?.lab ?? null, hours: u.hours ?? fromSpec?.hours ?? null };
  });

  const labText = units.map((u) => u.lab ?? "").join(" ").trim();
  const { template: ruleTemplate, signals } = chooseTemplate(spec.credits.ltp, spec.header.type ?? null, labText);
  const template = options.templateOverride?.template ?? ruleTemplate;
  if (options.templateOverride) {
    signals.push(`manual override to ${template}: ${options.templateOverride.reason}`);
    notes.push(`Template overridden by the Author: ${options.templateOverride.reason}`);
  }

  const cos: CoInput[] = coSource.map((co) => ({
    id: co.id,
    statement: co.statement,
    bloom: bloomFromStatement(co.statement) ?? 3,
  }));

  const evidence: Evidence = {
    syllabus: units.map((u) => u.content).join(" ").toLowerCase(),
    practical: labText.toLowerCase(),
    components: spec.assessment.leaves.map((l) => l.name.toLowerCase()),
    integrated: template === "integrated",
  };

  let map = buildMap(cos, evidence);
  let summary = spec.summary;
  let aiUsed = false;

  if (options.llm) {
    try {
      const reply = await generateJson(aiPrompt(cos, units, map, evidence, summary), aiSchema, options.llm);
      aiUsed = true;
      if (reply.summary) summary = norm(reply.summary);
      for (const row of reply.outcomes ?? []) {
        const co = cos.find((c) => c.id === row.id);
        // The verb table wins; the AI only fills in what no listed verb covered.
        if (co && bloomFromStatement(co.statement) === null) co.bloom = row.bloom_level;
      }
      if ((reply.map ?? []).length) {
        for (const change of reply.map ?? []) {
          const row = map[change.co];
          if (!row) continue;
          if (change.level === 0) delete row[change.column];
          else row[change.column] = { level: change.level, justification: norm(change.justification) };
        }
      }
    } catch (e) {
      notes.push(`The AI step did not complete (${(e as Error).message}); the rule-based result was used.`);
      map = buildMap(cos, evidence);
    }
  } else {
    notes.push("No AI key was supplied: the rule-based mapping and summary were used.");
  }

  const clampNotes = clampMap(map, cos, evidence);
  notes.push(...clampNotes);
  if (!summary || summary.length < 40) summary = summaryFallback(spec.summary, units);
  // The summary must name every unit theme; top it up when the AI's version misses one.
  const summaryLower = summary.toLowerCase();
  const missed = units.filter((u) => u.title && !summaryLower.includes(u.title.toLowerCase().split(/\s+/)[0]));
  if (missed.length) summary = summaryFallback(summary, missed);

  const lectures = number(spec.hours.lectures, units.reduce((a, u) => a + number(u.hours), 0));
  const lab = number(spec.hours.lab, template === "integrated" ? 30 : 0);
  const tests = number(spec.hours.tests);
  const hours = { lectures, lab, tests_exams: tests, total: lectures + lab + tests };

  let components = spec.assessment.components.map((c) => ({ name: c.name, weight_percent: c.weight }));
  if (!components.length) components = [{ name: "Continuous Evaluation", weight_percent: 60 }, { name: "Semester End Examination", weight_percent: 40 }];
  const weightSum = components.reduce((a, c) => a + c.weight_percent, 0);
  if (Math.round(weightSum) !== 100 && weightSum > 0) {
    components = components.map((c) => ({ name: c.name, weight_percent: Math.round((c.weight_percent / weightSum) * 1000) / 10 }));
  }

  // Every CO is assessed: continuous evaluation and the end exam always, the lab
  // component as well when the course has one and the outcome is at least Apply.
  const labComponent = components.find((c) => /lab|practical/i.test(c.name));
  const seeComponent = components.find((c) => /see|end|written/i.test(c.name)) ?? components[components.length - 1];
  const ceComponent = components.find((c) => /ce|continuous|test/i.test(c.name)) ?? components[0];
  const coverage: Record<string, string[]> = {};
  for (const co of cos) {
    const names = new Set<string>([ceComponent.name, seeComponent.name]);
    if (labComponent && template === "integrated" && co.bloom >= 3) names.add(labComponent.name);
    const strongApplied = ["PO-3", "PO-5"].some((col) => (map[co.id]?.[col]?.level ?? 0) >= 2);
    if (strongApplied && labComponent) names.add(labComponent.name);
    coverage[co.id] = [...names];
  }

  const placeholders = templatePlaceholders(template);
  const defects = runValidation({
    spec,
    blueprint,
    cos,
    units,
    map,
    hours,
    components: components.map((c) => ({ name: c.name, weight: c.weight_percent })),
    coverage,
    template,
    templateSignals: signals,
    placeholders,
    evidence,
    clampNotes,
  });

  const output = outputSchema.parse({
    schema_version: "1.0",
    input_id: inputId(`${spec.text}\n${blueprintText}`, [options.spec.name, options.blueprint?.name ?? ""]),
    template,
    course: {
      title: spec.header.title ?? blueprint?.header.title ?? "Untitled course",
      code: spec.header.code ?? blueprint?.header.code ?? "UNKNOWN",
      department: spec.header.department ?? "Not stated",
      credits_ltp: spec.credits.ltp ?? "0:0:0",
      course_type: spec.header.type ?? (template === "integrated" ? "Core Theory and Laboratory" : "Core Theory"),
      summary,
    },
    course_outcomes: cos.map((c) => ({ id: c.id, statement: c.statement, bloom_level: c.bloom })),
    units: units.map((u) => ({ number: u.number, title: u.title, lab: template === "integrated" ? u.lab : null })),
    co_po_pso_map: map,
    teaching_hours: hours,
    assessment: { components, co_coverage: coverage },
    defects: defects.map((d) => ({ code: d.code, location: d.location, description: d.description, fix: d.fix })),
  });

  const render = {
    units: units.map((u) => ({ number: u.number, title: u.title, content: u.content, lab: u.lab })),
    credits: {
      number: spec.credits.number,
      weeks: spec.credits.weeks,
      marks: spec.credits.marks,
      faculty: spec.header.faculty ?? null,
    },
    resources: groupResources(spec.resourceLines),
  };
  const html = renderSpec({ output, ...render, status: options.status ?? "Draft" });

  return { output, html, defects, signals, notes, aiUsed, render };
}
