// Pulls structured facts out of a parsed document with plain rules.
// Every pattern here is about document LABELS, never about a particular course.
import type { ParsedDoc } from "./docs.js";

export type CoRow = { id: string; statement: string };
export type UnitRow = { number: number; title: string; content: string; hours: number | null; lab: string | null; marks: number | null };
export type MapRow = { co: string; cells: Record<string, number | null> };
export type AssessmentLeaf = { name: string; marks: number | null; cos: string[] };

export type ExtractedSpec = {
  header: Record<string, string>;
  summary: string;
  credits: { number: string | null; ltp: string | null; totalHours: number | null; weeks: string | null; marks: number | null };
  cos: CoRow[];
  units: UnitRow[];
  map: { columns: string[]; rows: MapRow[] };
  hours: { rows: { label: string; value: number }[]; lectures: number | null; lab: number | null; tests: number | null; statedTotal: number | null };
  assessment: { components: { name: string; weight: number }[]; leaves: AssessmentLeaf[] };
  extraSections: string[];
  resourceLines: string[];
  text: string;
};

export const norm = (s: string) => s.replace(/ /g, " ").replace(/\s+/g, " ").trim();
const lower = (s: string) => norm(s).toLowerCase();
const num = (s: string): number | null => {
  const m = norm(s).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

/** Every table row in the document, flattened, so label lookups are cheap. */
function allRows(doc: ParsedDoc): string[][] {
  return doc.tables.flat();
}

/** First row whose first cell matches, returning the first later cell that has text. */
function rowValue(rows: string[][], label: RegExp): string | null {
  for (const row of rows) {
    if (!row.length || !label.test(lower(row[0]))) continue;
    for (const cell of row.slice(1)) {
      const v = norm(cell);
      if (v) return v;
    }
  }
  return null;
}

/** Label/value pairs written as two consecutive lines, which is what .docx text looks like. */
function lineValue(text: string, label: RegExp): string | null {
  const lines = text.split(/\r?\n/).map(norm).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (!label.test(lower(lines[i]))) continue;
    const parts = lines[i].split(/:\s+/);
    if (parts.length > 1 && norm(parts.slice(1).join(": "))) return norm(parts.slice(1).join(": "));
    if (lines[i + 1] && !label.test(lower(lines[i + 1]))) return lines[i + 1];
  }
  return null;
}

function find(doc: ParsedDoc, label: RegExp): string | null {
  return rowValue(allRows(doc), label) ?? lineValue(doc.text, label);
}

const LTP = /\b(\d{1,2})\s*[:\-]\s*(\d{1,2})\s*[:\-]\s*(\d{1,2})\b/;

export function extractHeader(doc: ParsedDoc) {
  const title = find(doc, /^course\s*title/) ?? find(doc, /^title$/);
  const code = find(doc, /^course\s*code/) ?? find(doc, /^code$/);
  const type = find(doc, /^course\s*type/);
  const department = find(doc, /^department$/) ?? find(doc, /^department responsible/) ?? find(doc, /^department\b/);
  const faculty = find(doc, /^faculty/);
  const programme = find(doc, /^programme$/) ?? find(doc, /^programme name$/);
  const ltpRaw = find(doc, /credit structure|lecture\s*:\s*tutorial/);
  const ltp = (ltpRaw && ltpRaw.match(LTP)) || doc.text.match(LTP);
  const entries = Object.entries({ title, code, type, department, faculty, programme }).filter(([, v]) => Boolean(v));
  return {
    header: Object.fromEntries(entries as [string, string][]),
    ltp: ltp ? `${Number(ltp[1])}:${Number(ltp[2])}:${Number(ltp[3])}` : null,
  };
}

/** Text that follows a heading, up to the next known heading. */
export function sectionText(text: string, start: RegExp, stops: RegExp[]): string {
  const lines = text.split(/\r?\n/);
  let from = -1;
  for (let i = 0; i < lines.length; i++) {
    if (start.test(lower(lines[i]))) {
      from = i + 1;
      break;
    }
  }
  if (from < 0) return "";
  const out: string[] = [];
  for (let i = from; i < lines.length; i++) {
    const l = lower(lines[i]);
    if (l && stops.some((s) => s.test(l))) break;
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}

const CO_LINE = /\bCO\s*[-–]?\s*(\d{1,2})\s*[.):\]]?\s+(.{8,})$/i;

/** Course outcomes from numbered lines or from a two-column table. */
export function extractCos(doc: ParsedDoc): CoRow[] {
  const found = new Map<number, string>();
  for (const row of allRows(doc)) {
    const id = norm(row[0] ?? "").match(/^CO\s*[-–]?\s*(\d{1,2})$/i);
    const statement = norm(row[1] ?? "");
    if (id && statement.length > 8 && !/^description$/i.test(statement)) found.set(Number(id[1]), statement);
  }
  for (const raw of doc.text.split(/\r?\n/)) {
    const line = norm(raw);
    const m = line.match(CO_LINE);
    if (!m) continue;
    const n = Number(m[1]);
    const statement = norm(m[2]);
    if (!found.has(n) && statement.length > 8) found.set(n, statement);
  }
  return [...found.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, statement]) => ({ id: `CO-${n}`, statement: statement.endsWith(".") ? statement : `${statement}.` }));
}

const UNIT_HEAD = /^unit\s*[-–]?\s*(\d{1,2})\s*(?:\(([^)]+)\))?\s*[:.\-]?\s*(.*)$/i;

function titleOf(content: string): string {
  const t = norm(content).split(/[:.]/)[0];
  return norm(t);
}

/** Units from "Unit n (Title): content" blocks, with the lab lines attached. */
export function extractUnitsFromSpec(doc: ParsedDoc): UnitRow[] {
  const lines = doc.text.split(/\r?\n/).map(norm);
  const units: UnitRow[] = [];
  let current: UnitRow | null = null;
  for (const line of lines) {
    if (!line) continue;
    const head = line.match(UNIT_HEAD);
    if (head && (head[2] || head[3])) {
      const content = norm(head[2] ? `${head[2]}: ${head[3]}` : head[3]);
      current = {
        number: Number(head[1]),
        title: head[2] ? norm(head[2]) : titleOf(content),
        content,
        hours: null,
        lab: null,
        marks: null,
      };
      units.push(current);
      continue;
    }
    if (!current) continue;
    if (/^lab\s*exercises?/i.test(line)) {
      const labText = norm(line.replace(/^lab\s*exercises?\s*(on|:)?\s*/i, "")).replace(/\.$/, "");
      current.lab = current.lab ? `${current.lab}; ${labText}` : labText;
      continue;
    }
    if (/^(course map|course teaching|course assessment|achieving|course resources|course organi[sz]ation)/i.test(line)) current = null;
  }
  return units;
}

/** Units from a blueprint's unit-wise distribution table. */
export function extractUnitsFromBlueprint(doc: ParsedDoc): UnitRow[] {
  const units: UnitRow[] = [];
  const rows = allRows(doc);
  rows.forEach((row, index) => {
    const first = norm(row[0] ?? "");
    if (!/^\d{1,2}$/.test(first)) return;
    let body = norm(row[1] ?? "");
    if (body.length < 12) return;
    // Some rows end with the unit's hours glued to the syllabus text.
    const glued = body.match(/\s(\d{1,2})$/);
    let hoursFromBody: number | null = null;
    if (glued) {
      hoursFromBody = Number(glued[1]);
      body = norm(body.slice(0, glued.index));
    }
    const inline = row.slice(2).map((c) => num(c)).filter((n): n is number => n !== null);
    // Some .doc tables put the hours and marks on the following short rows.
    const trailing: number[] = [];
    for (let i = index + 1; i < rows.length && trailing.length < 4; i++) {
      const cells = rows[i].map(norm).filter(Boolean);
      if (!cells.length) continue;
      if (/^\d{1,2}$/.test(cells[0]) && (rows[i][1] ?? "").length > 12) break;
      for (const c of cells) {
        const v = num(c);
        if (v !== null && c.length <= 4) trailing.push(v);
      }
    }
    const numbers = inline.length ? inline : trailing;
    units.push({
      number: Number(first),
      title: titleOf(body),
      content: body,
      hours: hoursFromBody ?? numbers.find((n) => n > 0 && n <= 60) ?? null,
      lab: null,
      marks: numbers.length ? numbers[numbers.length - 1] : null,
    });
  });
  return units.sort((a, b) => a.number - b.number);
}

const PO_HEAD = /^(PO|PSO)\s*[-–]?\s*(\d{1,2})$/i;

/** The CO-PO-PSO table already in the document, with the columns it actually has. */
export function extractMap(doc: ParsedDoc): { columns: string[]; rows: MapRow[] } {
  for (const table of doc.tables) {
    let headerIndex = -1;
    const columns: string[] = [];
    for (let i = 0; i < table.length; i++) {
      const ids = table[i].map(norm).filter((c) => PO_HEAD.test(c));
      if (ids.length < 5) continue;
      headerIndex = i;
      for (const c of ids) {
        const m = norm(c).match(PO_HEAD)!;
        columns.push(`${m[1].toUpperCase()}-${Number(m[2])}`);
      }
      break;
    }
    if (headerIndex < 0) continue;
    const rows: MapRow[] = [];
    for (const row of table.slice(headerIndex + 1)) {
      const id = norm(row[0] ?? "").match(/^CO\s*[-–]?\s*(\d{1,2})/i);
      if (!id) continue;
      const values = row.slice(1).map((c) => {
        const v = num(c);
        return v === 1 || v === 2 || v === 3 ? v : null;
      });
      const cells: Record<string, number | null> = {};
      columns.forEach((col, i) => {
        cells[col] = values[i] ?? null;
      });
      rows.push({ co: `CO-${Number(id[1])}`, cells });
    }
    if (rows.length) return { columns, rows };
  }
  // Fall back to the flat "CO-1 / 1 / 1 ..." shape that .docx text produces.
  const lines = doc.text.split(/\r?\n/).map(norm);
  const columns: string[] = [];
  for (const line of lines) {
    const m = line.match(PO_HEAD);
    if (m) columns.push(`${m[1].toUpperCase()}-${Number(m[2])}`);
  }
  if (!columns.length) return { columns: [], rows: [] };
  const rows: MapRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^CO\s*[-–]?\s*\d{1,2}$/i.test(lines[i])) continue;
    const co = `CO-${Number(lines[i].match(/(\d{1,2})/)![1])}`;
    const cells: Record<string, number | null> = {};
    let col = 0;
    for (let j = i + 1; j < lines.length && col < columns.length; j++) {
      const line = lines[j];
      if (!line) continue;
      if (/^CO\s*[-–]?\s*\d{1,2}$/i.test(line) || /contribution/i.test(line)) break;
      const v = num(line);
      if (line.length <= 2 && (v === 1 || v === 2 || v === 3)) cells[columns[col]] = v;
      else break;
      col++;
    }
    if (Object.keys(cells).length) rows.push({ co, cells });
  }
  return { columns, rows };
}

/** Teaching-hours table: the group rows, not the indented sub-rows. */
export function extractHours(doc: ParsedDoc) {
  const rows: { label: string; value: number }[] = [];
  for (const row of allRows(doc)) {
    const label = norm(row[0] ?? "");
    if (!label || /^\d/.test(label)) continue;
    const value = row.slice(1).map(num).find((n) => n !== null);
    if (value === null || value === undefined) continue;
    rows.push({ label, value });
  }
  const textRows: { label: string; value: number }[] = [];
  const lines = doc.text.split(/\r?\n/).map(norm).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    if (/^\d/.test(lines[i])) continue;
    const next = lines.slice(i + 1, i + 3).find((l) => /^\d{1,3}$/.test(l));
    if (next) textRows.push({ label: lines[i], value: Number(next) });
  }
  const all = rows.length ? rows : textRows;
  const pick = (re: RegExp) => all.find((r) => re.test(lower(r.label)))?.value ?? null;
  return {
    rows: all,
    lectures: pick(/face to face|^lectures?\b/),
    lab: pick(/practical work|^laborator/),
    tests: pick(/term tests|mid terms?|laboratory examination|written examination|tests?.*examination/),
    statedTotal: pick(/total duration/),
  };
}

const PERCENT = /(\d{1,3}(?:\.\d+)?)\s*%/;

/** Assessment components (the ones carrying a weightage) and the CO rows under them. */
export function extractAssessment(doc: ParsedDoc) {
  const components: { name: string; weight: number }[] = [];
  const leaves: AssessmentLeaf[] = [];

  const pushComponent = (text: string) => {
    const pct = text.match(PERCENT);
    if (!pct) return;
    const name = norm(
      text
        .replace(PERCENT, "")
        .replace(/weightage\s*:?/i, "")
        .replace(/[()]/g, ""),
    );
    if (name && !components.some((c) => c.name === name)) components.push({ name, weight: Number(pct[1]) });
  };

  for (const table of doc.tables) {
    const headerIndex = table.findIndex((row) => row.filter((c) => PERCENT.test(c)).length >= 2);
    if (headerIndex < 0) continue;
    for (const cell of table[headerIndex]) pushComponent(norm(cell));
    const coRows = table.filter((row) => /^CO\s*[-–]?\s*\d{1,2}$/i.test(norm(row[0] ?? "")));
    const labelRow = table
      .slice(headerIndex + 1)
      .find((row) => row.filter((c) => norm(c) && !PERCENT.test(c) && !/marks/i.test(c) && !/^x$/i.test(norm(c))).length >= 2 && !/^CO/i.test(norm(row[0] ?? "")));
    const labels = labelRow ? labelRow.map(norm).filter(Boolean) : [];
    for (const row of coRows) {
      const co = `CO-${Number(norm(row[0]).match(/(\d{1,2})/)![1])}`;
      row.slice(1).forEach((cell, i) => {
        if (!/^x$/i.test(norm(cell))) return;
        const name = labels[i] ?? `Component ${i + 1}`;
        let leaf = leaves.find((l) => l.name === name);
        if (!leaf) {
          leaf = { name, marks: null, cos: [] };
          leaves.push(leaf);
        }
        if (!leaf.cos.includes(co)) leaf.cos.push(co);
      });
    }
    if (components.length) break;
  }

  if (!components.length) {
    // Percentages written inline in the body text, e.g. "CE (Weightage: 60 %)".
    const matches = doc.text.match(/[A-Za-z][A-Za-z /]{1,30}\(?\s*weightage\s*:?\s*\d{1,3}\s*%/gi) ?? [];
    for (const m of matches) pushComponent(norm(m));
  }
  return { components, leaves };
}

const KNOWN_SECTIONS = [
  /course summary/,
  /course size and credits/,
  /course outcomes/,
  /course contents/,
  /course map/,
  /teaching and learning methods/,
  /course assessment/,
  /achieving co/,
  /course resources/,
];

/** Headings in the document that the official template has no place for. */
export function extractExtraSections(doc: ParsedDoc): string[] {
  // A line that is also a table label is a field name, not a section heading.
  const labels = new Set(allRows(doc).map((row) => lower(row[0] ?? "")));
  const out: string[] = [];
  for (const raw of doc.text.split(/\r?\n/)) {
    const line = norm(raw);
    if (!line || line.length > 60 || /[.;,]$/.test(line)) continue;
    if (!/^(course|achieving|programme)\s/i.test(line)) continue;
    const l = lower(line);
    if (KNOWN_SECTIONS.some((s) => s.test(l))) continue;
    // Column group labels of the map table are not sections.
    if (/^programme (specific )?outcomes/.test(l)) continue;
    if (/specifications?\b/.test(l) || labels.has(l)) continue;
    if (!out.includes(line)) out.push(line);
  }
  return out;
}

const RESOURCE_GROUPS: [RegExp, string][] = [
  [/essential reading/i, "essential"],
  [/recommended reading/i, "recommended"],
  [/magazines? and journals/i, "magazines"],
  [/^websites?$/i, "websites"],
  [/other electronic resources/i, "electronic"],
];

/** Course resources split under the sub-headings the template uses. */
export function groupResources(lines: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  let current = "essential";
  for (const line of lines) {
    const heading = RESOURCE_GROUPS.find(([re]) => re.test(line.replace(/[:.]$/, "")));
    if (heading && line.length < 60) {
      current = heading[1];
      continue;
    }
    (groups[current] ??= []).push(line);
  }
  return groups;
}

export function extractSpec(doc: ParsedDoc): ExtractedSpec {
  const { header, ltp } = extractHeader(doc);
  const summary = sectionText(doc.text, /^course summary$/, [/^course size/, /^course outcomes/]);
  return {
    header,
    summary: norm(summary),
    credits: {
      number: find(doc, /number of credits/),
      ltp,
      totalHours: num(find(doc, /total hours of interaction/) ?? ""),
      weeks: find(doc, /number of weeks/),
      marks: num(find(doc, /total course marks/) ?? ""),
    },
    cos: extractCos(doc),
    units: extractUnitsFromSpec(doc),
    map: extractMap(doc),
    hours: extractHours(doc),
    assessment: extractAssessment(doc),
    extraSections: extractExtraSections(doc),
    resourceLines: sectionText(doc.text, /^course resources$/, [/^course organi[sz]ation/])
      .split(/\r?\n/)
      .map(norm)
      .filter(Boolean),
    text: doc.text,
  };
}
