// Bloom's level from the leading verb, using the verb table in config/po_pso.json.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type PoDef = { id: string; title: string; statement: string };
export type PsoDef = { id: string; statement: string };
type BloomDef = { level: string; name: string; verbs: string };

const config = JSON.parse(readFileSync(resolve(process.cwd(), "config/po_pso.json"), "utf8")) as {
  scale: string;
  pos: PoDef[];
  psos: PsoDef[];
  blooms: BloomDef[];
};

export const POS: PoDef[] = config.pos;
export const PSOS: PsoDef[] = config.psos;
export const BLOOM_NAMES: Record<number, string> = Object.fromEntries(
  config.blooms.map((b) => [Number(b.level.replace(/\D/g, "")), b.name]),
);

/** verb -> level, built from the reference verb list. */
const VERB_LEVEL = new Map<string, number>();
for (const b of config.blooms) {
  const level = Number(b.level.replace(/\D/g, ""));
  for (const raw of b.verbs.split(",")) {
    const verb = raw.replace(/\(.*?\)/g, "").trim().toLowerCase();
    if (verb) VERB_LEVEL.set(verb, level);
  }
}

/** Common verb endings so "analyzing"/"analyses"/"analyze" all resolve. */
function verbForms(word: string): string[] {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  const forms = new Set([w, w.replace(/ing$/, ""), w.replace(/s$/, ""), w.replace(/ed$/, "")]);
  if (w.endsWith("ing")) forms.add(`${w.slice(0, -3)}e`);
  if (w.endsWith("ze")) forms.add(w.replace(/ze$/, "se"));
  if (w.endsWith("se")) forms.add(w.replace(/se$/, "ze"));
  if (w.endsWith("zing")) forms.add(w.replace(/zing$/, "se"));
  if (w.endsWith("sing")) forms.add(w.replace(/sing$/, "ze"));
  return [...forms].filter(Boolean);
}

/** The level of the first verb in the statement, or null when no listed verb appears. */
export function bloomFromStatement(statement: string): number | null {
  const words = statement.split(/[^A-Za-z]+/).filter(Boolean);
  for (const word of words) {
    for (const form of verbForms(word)) {
      const level = VERB_LEVEL.get(form);
      if (level) return level;
    }
  }
  return null;
}

export function leadingVerb(statement: string): string {
  const first = statement.split(/[^A-Za-z]+/).find(Boolean) ?? "";
  return first.toLowerCase();
}
