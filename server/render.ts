// Fills an official template in templates/ with the corrected spec.
// The template's headings, numbering, tables, CSS and PDF button stay exactly as they are.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as cheerio from "cheerio";
import { POS, PSOS } from "./bloom.js";
import type { SpecForgeOutput } from "./output.js";

export type TemplateName = "integrated" | "non_lab";

const FILES: Record<TemplateName, string> = {
  integrated: "templates/integrated_lab.html",
  non_lab: "templates/non_lab.html",
};

export function templateHtml(name: TemplateName): string {
  return readFileSync(resolve(process.cwd(), FILES[name]), "utf8");
}

/** The blank template's sample course identity: title, code and department.
 * Boilerplate the real spec shares with the template (regulations, headings) is
 * deliberately excluded, so a match here is always leftover sample content. */
export function templatePlaceholders(name: TemplateName): string[] {
  const $ = cheerio.load(templateHtml(name));
  const out = new Set<string>();
  const add = (text: string) => {
    const value = text.replace(/\s+/g, " ").trim();
    if (value.length >= 4 && !/^\d+(:\d+)*$/.test(value)) out.add(value);
  };
  add($("h1 span[contenteditable='true']").first().text());
  $("tr").each((_i, tr) => {
    const cells = $(tr).children("td");
    if (cells.length < 2) return;
    const label = $(cells[0]).text().replace(/\s+/g, " ").trim();
    if (/^(Course Title|Course Code|Department)$/i.test(label)) add($(cells[cells.length - 1]).text());
  });
  return [...out];
}

export type RenderInput = {
  output: SpecForgeOutput;
  units: { number: number; title: string; content: string; lab: string | null }[];
  credits: { number: string | null; weeks: string | null; marks: number | null; faculty: string | null };
  resources: Record<string, string[]>;
  status: string;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Sets the value cell of the row whose label cell matches. */
function setRow($: cheerio.CheerioAPI, label: RegExp, value: string) {
  $("tr").each((_i, tr) => {
    const cells = $(tr).children("td");
    if (cells.length < 2) return;
    const name = $(cells[0]).text().replace(/\s+/g, " ").trim();
    if (!label.test(name)) return;
    $(cells[cells.length - 1]).text(value);
  });
}

/** The element that follows a numbered section heading. */
function afterHeading($: cheerio.CheerioAPI, section: number) {
  const heading = $("h2").filter((_i, el) => new RegExp(`^\\s*${section}\\.`).test($(el).text())).first();
  return heading;
}

export function renderSpec(input: RenderInput): string {
  const { output, units, credits, resources, status } = input;
  const $ = cheerio.load(templateHtml(output.template));

  // Title line and the header table.
  const titleSpan = $("h1 span[contenteditable='true']").first();
  if (titleSpan.length) titleSpan.text(output.course.title);
  else $("h1").text(`Course Specifications: ${output.course.title}`);
  setRow($, /^Course Title$/i, output.course.title);
  setRow($, /^Course Code$/i, output.course.code);
  setRow($, /^Course Type$/i, output.course.course_type);
  setRow($, /^Department$/i, output.course.department);
  if (credits.faculty) setRow($, /^Faculty$/i, credits.faculty);

  // 1. Course Summary
  const summaryP = afterHeading($, 1).nextAll("p").first();
  if (summaryP.length) summaryP.text(output.course.summary);

  // 2. Course Size and Credits
  if (credits.number) setRow($, /^Number of Credits$/i, credits.number);
  setRow($, /Credit Structure/i, output.course.credits_ltp);
  setRow($, /Total Hours of Interaction/i, String(output.teaching_hours.total));
  if (credits.weeks) setRow($, /Number of Weeks/i, credits.weeks);
  setRow($, /Department Responsible/i, output.course.department);
  if (credits.marks !== null) setRow($, /Total Course Marks/i, String(credits.marks));

  // 3. Course Outcomes
  const coList = $("ul.co-list").first();
  if (coList.length) {
    coList.empty();
    for (const co of output.course_outcomes) coList.append(`<li>${esc(co.statement)}</li>`);
  }

  // 4. Course Contents, one row per unit, with the lab line for a lab course.
  const unitRows = $(".unit-row");
  if (unitRows.length) {
    const first = unitRows.first();
    const labelStyle = first.find("span.unit-label").attr("style") ?? "";
    unitRows.slice(1).remove();
    const blocks = units
      .map((u) => {
        const lab =
          output.template === "integrated" && u.lab
            ? `<div class="unit-row"><span class="static unit-label" style="${labelStyle}">Lab Exercises:</span> <span contenteditable="true">${esc(u.lab)}</span></div>`
            : "";
        return `<div class="unit-row"><span class="static unit-label" style="${labelStyle}">Unit ${u.number}:</span> <span contenteditable="true">${esc(u.content)}</span></div>${lab}`;
      })
      .join("\n");
    first.replaceWith(blocks);
  }

  // 5. CO-PO-PSO map: rebuild the body rows in the template's own column order.
  const copo = $("table.copo-table").first();
  if (copo.length) {
    const columns: string[] = [];
    copo.find("thead th").each((_i, th) => {
      const text = $(th).text().replace(/\s+/g, " ").trim();
      if (/^(PO|PSO)-\d+$/.test(text)) columns.push(text);
    });
    const cols = columns.length ? columns : [...POS.map((p) => p.id), ...PSOS.map((p) => p.id)];
    const body = copo.find("tbody").first();
    const legend = body.find("tr.copo-legend-row").first();
    const legendHtml = legend.length ? $.html(legend) : "";
    body.empty();
    for (const co of output.course_outcomes) {
      const row = output.co_po_pso_map[co.id] ?? {};
      const cells = cols
        .map((col) => {
          const cell = row[col];
          const value = cell ? String(cell.level) : "";
          const title = cell ? ` title="${esc(cell.justification)}"` : "";
          return `<td class="text-center" contenteditable="true"${title}>${value}</td>`;
        })
        .join("");
      body.append(`<tr><td class="text-center" contenteditable="true" style="font-weight:bold;">${co.id}</td>${cells}</tr>`);
    }
    if (legendHtml) body.append(legendHtml);
  }

  // 6. Teaching and learning methods.
  setRow($, /Face to Face Lectures/i, String(output.teaching_hours.lectures));
  setRow($, /^Practical Work$/i, String(output.teaching_hours.lab));
  setRow($, /Computer Laboratory/i, String(output.teaching_hours.lab));
  setRow($, /Term Tests|Laboratory Examination|Mid Terms/i, String(output.teaching_hours.tests_exams));
  setRow($, /Total Duration in Hours/i, String(output.teaching_hours.total));

  // 7. Assessment: X marks per CO row, against the template's own columns.
  const assessTable = $("table").filter((_i, t) => /Focus of COs/i.test($(t).text())).first();
  if (assessTable.length) {
    const labels: string[] = [];
    assessTable.find("thead tr").each((_i, tr) => {
      const texts = $(tr)
        .children("th")
        .map((_j, th) => $(th).text().replace(/\s+/g, " ").trim())
        .get();
      if (texts.filter((t) => t && !/weightage|marks|focus|^CO/i.test(t)).length >= 2) {
        labels.length = 0;
        labels.push(...texts.filter((t) => t));
      }
    });
    const body = assessTable.find("tbody").first();
    body.empty();
    for (const co of output.course_outcomes) {
      const covered = output.assessment.co_coverage[co.id] ?? [];
      const cells = labels
        .map((label) => {
          const hit = covered.some((name) => {
            const l = label.toLowerCase();
            const n = name.toLowerCase();
            if (l.includes("lab") && n.includes("lab")) return true;
            if ((l.includes("written") || l.includes("see")) && (n.includes("see") || n.includes("written") || n.includes("end"))) return true;
            if ((l.includes("test") || l.includes("assignment")) && (n.includes("ce") || n.includes("continuous") || n.includes("test") || n.includes("assignment"))) return true;
            return false;
          });
          return `<td class="text-center" contenteditable="true">${hit ? "X" : ""}</td>`;
        })
        .join("");
      body.append(`<tr><td class="static text-center" style="font-weight: bold;">${co.id}</td>${cells}</tr>`);
    }
  }

  // 9. Course Resources, grouped under the template's own sub-headings.
  const resourceGroups: [RegExp, string][] = [
    [/essential reading/i, "essential"],
    [/recommended reading/i, "recommended"],
    [/magazines? and journals/i, "magazines"],
    [/websites?/i, "websites"],
    [/other electronic resources/i, "electronic"],
  ];
  $("h3").each((_i, h3) => {
    const heading = $(h3).text().replace(/\s+/g, " ").trim();
    const group = resourceGroups.find(([re]) => re.test(heading));
    if (!group) return;
    const list = $(h3).nextAll("ol").first();
    const items = resources[group[1]] ?? [];
    if (!list.length || !items.length) return;
    list.empty();
    for (const item of items) list.append(`<li>${esc(item)}</li>`);
  });

  // DRAFT watermark until the spec is approved. Shown on screen and in print.
  if (status.toLowerCase() !== "approved") {
    $("head").append(
      `<style id="draft-watermark">.page{position:relative}.page::before{content:"DRAFT";position:fixed;top:40%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:120pt;color:rgba(200,0,0,.12);font-weight:700;letter-spacing:.1em;pointer-events:none;z-index:9999}@media print{.page::before{position:fixed;display:block}}</style>`,
    );
  }
  $("title").text(`${output.course.code} ${output.course.title}`);
  return $.html();
}
