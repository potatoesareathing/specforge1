// npm run audit   Checks outputs/spec.html against outputs/specforge_output.json
// the way the spec-document part of the score is checked: sections in order, no
// template sample text, the right template, course details, every CO, and a map
// table that agrees with the JSON.
import { readFileSync, existsSync } from "node:fs";
import * as cheerio from "cheerio";

const jsonPath = process.argv[2] ?? "outputs/specforge_output.json";
const htmlPath = process.argv[3] ?? "outputs/spec.html";
for (const file of [jsonPath, htmlPath]) {
  if (!existsSync(file)) {
    console.error(`No file at ${file}. Run npm run verify first.`);
    process.exit(1);
  }
}

const output = JSON.parse(readFileSync(jsonPath, "utf8"));
const $ = cheerio.load(readFileSync(htmlPath, "utf8"));
const text = $("body").text().replace(/\s+/g, " ");
const problems: string[] = [];
const pass: string[] = [];

const SECTIONS = [
  "Course Summary",
  "Course Size and Credits",
  "Course Outcomes",
  "Course Contents",
  "Course Map",
  "Course Teaching and Learning Methods",
  "Course Assessment",
  "Achieving COs",
  "Course Resources",
];
const headings = $("h2").map((_i, el) => $(el).text().replace(/\s+/g, " ").trim()).get();
SECTIONS.forEach((name, i) => {
  const expected = `${i + 1}.`;
  const heading = headings[i] ?? "";
  if (!heading.startsWith(expected) || !heading.toLowerCase().includes(name.toLowerCase().slice(0, 12))) {
    problems.push(`Section ${i + 1} should be "${expected} ${name}" but the document has "${heading}".`);
  }
});
if (headings.length >= SECTIONS.length) pass.push(`${SECTIONS.length} template sections in order`);

// Sample text from the blank templates must not survive.
const samples = new Set<string>();
for (const file of ["templates/integrated_lab.html", "templates/non_lab.html"]) {
  const t = cheerio.load(readFileSync(file, "utf8"));
  t("h1 span[contenteditable='true'], ul.co-list li").each((_i, el) => {
    const value = t(el).text().replace(/\s+/g, " ").trim();
    if (value.length >= 8) samples.add(value);
  });
  t("tr").each((_i, tr) => {
    const cells = t(tr).children("td");
    if (cells.length < 2) return;
    const label = t(cells[0]).text().trim();
    if (/^(Course Title|Course Code|Department)$/i.test(label)) {
      const value = t(cells[cells.length - 1]).text().trim();
      if (value.length >= 4) samples.add(value);
    }
  });
}
const leftover = [...samples].filter((s) => text.includes(s) && !Object.values(output.course).includes(s));
if (leftover.length) problems.push(`Template sample text still in the document: ${leftover.slice(0, 3).map((s) => `"${s.slice(0, 40)}"`).join(", ")}`);
else pass.push("no leftover template sample text");

// Course details.
for (const [field, value] of [["title", output.course.title], ["code", output.course.code], ["credits", output.course.credits_ltp]] as const) {
  if (!text.includes(String(value))) problems.push(`The document does not show the course ${field} "${value}".`);
}
if (!problems.some((p) => p.includes("course "))) pass.push("course title, code and credits present");

// Every CO appears.
const missingCos = output.course_outcomes.filter((co: { statement: string }) => !text.includes(co.statement.slice(0, 40)));
if (missingCos.length) problems.push(`${missingCos.length} course outcome(s) are missing from the document.`);
else pass.push(`all ${output.course_outcomes.length} course outcomes present`);

// The right template: the Integrated one is the only one with lab exercises.
const hasLab = /Lab Exercises/i.test(text);
if (output.template === "integrated" && !hasLab) problems.push("The output says integrated, but the document has no lab exercises.");
if (output.template === "non_lab" && hasLab) problems.push("The output says non_lab, but the document contains lab exercises.");
if (!problems.some((p) => p.includes("template"))) pass.push(`template "${output.template}" matches the document`);

// The map table must agree with the JSON, cell by cell.
const columns: string[] = [];
$("table.copo-table thead th").each((_i, th) => {
  const value = $(th).text().replace(/\s+/g, " ").trim();
  if (/^(PO|PSO)-\d+$/.test(value)) columns.push(value);
});
let mismatches = 0;
$("table.copo-table tbody tr").each((_i, tr) => {
  const cells = $(tr).children("td");
  const co = $(cells[0]).text().trim();
  if (!/^CO-\d+$/.test(co)) return;
  columns.forEach((column, i) => {
    const shown = $(cells[i + 1]).text().trim();
    const expected = output.co_po_pso_map[co]?.[column]?.level;
    const wanted = expected ? String(expected) : "";
    if (shown !== wanted) mismatches += 1;
  });
});
if (!columns.length) problems.push("No CO-PO-PSO table was found in the document.");
else if (mismatches) problems.push(`${mismatches} map cell(s) in the document disagree with the output file.`);
else pass.push("map table agrees with the output file");

for (const line of pass) console.log(`ok   ${line}`);
if (problems.length) {
  console.error(`\nSpec document problems:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("\nThe spec document matches the output file.");
