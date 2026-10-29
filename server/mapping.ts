// Re-derives the CO-PO-PSO map from the CO's Bloom level plus evidence found in
// the syllabus and the assessment plan. Rules only: no course content lives here.
import { POS, PSOS, type PoDef } from "./bloom.js";

export type Cell = { level: 1 | 2 | 3; justification: string };
export type CoPoMap = Record<string, Record<string, Cell>>;

export type Evidence = {
  /** Syllabus text of every unit, lowercased. */
  syllabus: string;
  /** Lab/practical text, lowercased. Empty for a theory-only course. */
  practical: string;
  /** Assessment component names, lowercased. */
  components: string[];
  integrated: boolean;
};

export type CoInput = { id: string; statement: string; bloom: number };

const has = (text: string, re: RegExp) => re.test(text);

const TOOL = /\b(python|program|programming|code|coding|ide|software|laborator|lab\b|workbook|plot|simulat|implement|tool|compiler|library|libraries)/;
const INVESTIGATE = /\b(experiment|testing|validation|data processing|analys|analyz|measure|interpret|simulat|efficien)/;
const WORLD = /\b(societ|environment|sustainab|economy|health|safety|legal|culture|ethic)/;
const ETHICS = /\b(ethic|plagiar|professional conduct|licen[cs]|intellectual property|law)/;
const TEAM = /\b(team|group work|collaborat|pair programming)/;
const COMMUNICATE = /\b(report|presentation|present\b|document|communicat|written communication|viva)/;
const PROJECT = /\b(project management|cost|budget|finance|schedul|resource planning)/;
const LIFELONG = /\b(self[- ]study|self[- ]learning|recent advance|new frontier|lifelong|life[- ]long|emerging|industry trend|continuing)/;
const PSO1 = /\b(comput|algorithm|data structure|program)/;
const PSO2 = /\b(design|develop|build|construct|software|tool|platform|application)/;

/** The strongest level a CO at this Bloom level may claim for a design-type PO. */
function designCap(bloom: number): 0 | 1 | 2 | 3 {
  if (bloom >= 6) return 3;
  if (bloom >= 4) return 2;
  if (bloom === 3) return 1;
  return 0;
}

function analysisCap(bloom: number): 0 | 1 | 2 | 3 {
  if (bloom >= 5) return 3;
  if (bloom === 4) return 3;
  if (bloom === 3) return 2;
  if (bloom === 2) return 1;
  return 0;
}

function knowledgeCap(bloom: number): 1 | 2 | 3 {
  if (bloom >= 3) return 3;
  if (bloom === 2) return 2;
  return 1;
}

/** A level for one PO column, or 0 for a blank cell. */
function levelFor(po: PoDef, co: CoInput, ev: Evidence, strict = true): 0 | 1 | 2 | 3 {
  const bloom = co.bloom;
  const statement = co.statement.toLowerCase();
  const text = `${statement} ${ev.syllabus} ${ev.practical}`;
  switch (po.id) {
    case "PO-1":
      return knowledgeCap(bloom);
    case "PO-2":
      return analysisCap(bloom);
    case "PO-3": {
      const cap = designCap(bloom);
      if (!cap) return 0;
      const designing = has(statement, PSO2) || has(ev.practical, PSO2);
      return designing ? cap : (Math.min(cap, 2) as 0 | 1 | 2 | 3);
    }
    case "PO-4": {
      // Investigation asks for an analysis-level outcome; the looser reading is
      // only used when judging the mapping already in the specification.
      if (!has(text, INVESTIGATE)) return 0;
      if (!strict) {
        const cap = analysisCap(bloom);
        return cap ? (Math.min(cap, bloom >= 4 ? 2 : 1) as 0 | 1 | 2 | 3) : 0;
      }
      if (bloom < 4) return 0;
      return bloom >= 5 ? 2 : 1;
    }
    case "PO-5": {
      if (!has(text, TOOL)) return 0;
      if (!ev.integrated && !has(statement, TOOL)) return 0;
      if (bloom >= 5) return 3;
      if (bloom >= 3) return 2;
      return 1;
    }
    case "PO-6":
      return has(ev.syllabus, WORLD) || has(statement, WORLD) ? 1 : 0;
    case "PO-7":
      return has(ev.syllabus, ETHICS) || has(statement, ETHICS) ? 1 : 0;
    case "PO-8":
      return has(ev.syllabus, TEAM) || ev.components.some((c) => TEAM.test(c)) ? 1 : 0;
    case "PO-9":
      return ev.components.some((c) => COMMUNICATE.test(c)) && has(ev.syllabus, COMMUNICATE) ? 1 : 0;
    case "PO-10":
      return has(ev.syllabus, PROJECT) ? 1 : 0;
    case "PO-11":
      return has(ev.syllabus, LIFELONG) ? (bloom >= 4 ? 2 : 1) : 0;
    default:
      return 0;
  }
}

function levelForPso(id: string, co: CoInput, ev: Evidence): 0 | 1 | 2 | 3 {
  const statement = co.statement.toLowerCase();
  const bloom = co.bloom;
  if (id === "PSO-1") {
    if (!has(`${statement} ${ev.syllabus}`, PSO1)) return 0;
    return knowledgeCap(bloom);
  }
  if (id === "PSO-2") {
    const designing = has(statement, PSO2) || has(ev.practical, PSO2);
    if (!designing) return 0;
    if (bloom >= 6) return 3;
    if (bloom >= 4) return 2;
    if (bloom === 3) return 2;
    return 1;
  }
  return 0;
}

const WORD: Record<1 | 2 | 3, string> = { 1: "moderate", 2: "strong", 3: "very strong" };

function reason(target: { id: string; title?: string }, co: CoInput, level: 1 | 2 | 3, ev: Evidence): string {
  const verb = co.statement.split(/[^A-Za-z]+/).find(Boolean)?.toLowerCase() ?? "the stated";
  const name = target.title ? `${target.id} (${target.title})` : target.id;
  const practical = ev.integrated ? " and the course laboratory work" : "";
  return `${WORD[level]}: an L${co.bloom} "${verb}" outcome supports ${name} through the unit syllabus${practical}.`;
}

/** The full map, every cell justified, with the Bloom ceiling already applied. */
export function buildMap(cos: CoInput[], ev: Evidence, strict = true): CoPoMap {
  const map: CoPoMap = {};
  for (const co of cos) {
    const row: Record<string, Cell> = {};
    for (const po of POS) {
      const level = levelFor(po, co, ev, strict);
      if (level) row[po.id] = { level, justification: reason(po, co, level, ev) };
    }
    for (const pso of PSOS) {
      const level = levelForPso(pso.id, co, ev);
      if (level) row[pso.id] = { level, justification: reason({ id: pso.id }, co, level, ev) };
    }
    // Rule: every CO maps to at least one PO.
    if (!Object.keys(row).some((k) => k.startsWith("PO-"))) {
      row["PO-1"] = { level: 1, justification: reason(POS[0], co, 1, ev) };
    }
    map[co.id] = row;
  }
  return map;
}

/** Clamps a map (ours or the AI's) back inside the rules. Returns what it changed. */
export function clampMap(map: CoPoMap, cos: CoInput[], ev: Evidence, strict = true): string[] {
  const notes: string[] = [];
  const byId = new Map(cos.map((c) => [c.id, c]));
  for (const [coId, row] of Object.entries(map)) {
    const co = byId.get(coId);
    if (!co) {
      delete map[coId];
      notes.push(`${coId} is not a defined course outcome, so its row was dropped.`);
      continue;
    }
    for (const [col, cell] of Object.entries(row)) {
      const ceiling = col.startsWith("PSO-") ? levelForPso(col, co, ev) : levelFor(POS.find((p) => p.id === col) ?? POS[0], co, ev, strict);
      if (!ceiling) {
        delete row[col];
        notes.push(`${coId}/${col} removed: no evidence in the syllabus or assessment supports it.`);
        continue;
      }
      if (cell.level > ceiling) {
        notes.push(`${coId}/${col} reduced from ${cell.level} to ${ceiling}: an L${co.bloom} outcome cannot support more.`);
        cell.level = ceiling;
      }
      if (!cell.justification?.trim()) cell.justification = reason({ id: col }, co, cell.level, ev);
    }
  }
  return notes;
}
