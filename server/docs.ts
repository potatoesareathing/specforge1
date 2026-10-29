// Reads an uploaded document into plain text plus simple table rows.
// Nothing here knows anything about a particular course.
import mammoth from "mammoth";
import * as cheerio from "cheerio";
import WordExtractor from "word-extractor";
import { ApiError } from "./envelope.js";

export type ParsedDoc = {
  name: string;
  kind: "docx" | "doc" | "pdf" | "html";
  text: string;
  /** Every table found in the document, as rows of trimmed cell text. */
  tables: string[][][];
};

const clean = (s: string) => s.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\s+\n/g, "\n").trim();

function tablesFromHtml(html: string): string[][][] {
  const $ = cheerio.load(html);
  const out: string[][][] = [];
  $("table").each((_i: number, t: unknown) => {
    const rows: string[][] = [];
    $(t as never)
      .find("tr")
      .each((_j: number, tr: unknown) => {
        const cells: string[] = [];
        $(tr as never)
          .find("th,td")
          .each((_k: number, td: unknown) => {
            cells.push(clean($(td as never).text()));
          });
        if (cells.length) rows.push(cells);
      });
    if (rows.length) out.push(rows);
  });
  return out;
}

function extOf(name: string): ParsedDoc["kind"] {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "docx") return "docx";
  if (ext === "doc") return "doc";
  if (ext === "pdf") return "pdf";
  if (ext === "html" || ext === "htm") return "html";
  throw new ApiError(400, "UNSUPPORTED_FILE", `Cannot read "${name}". Upload a .docx, .doc, .pdf or .html file.`);
}

export async function readDocument(buffer: Buffer, name: string): Promise<ParsedDoc> {
  const kind = extOf(name);
  try {
    if (kind === "docx") {
      const html = (await mammoth.convertToHtml({ buffer })).value;
      const text = (await mammoth.extractRawText({ buffer })).value;
      return { name, kind, text: clean(text), tables: tablesFromHtml(html) };
    }
    if (kind === "doc") {
      const doc = await new WordExtractor().extract(buffer);
      const body = doc.getBody();
      // word-extractor gives tab-separated cells; treat tab rows as table rows.
      const rows = body
        .split(/\r?\n/)
        .filter((line) => line.includes("\t"))
        .map((line) => line.split("\t").map((c) => clean(c)));
      return { name, kind, text: clean(body), tables: rows.length ? [rows] : [] };
    }
    if (kind === "pdf") {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      await parser.destroy();
      return { name, kind, text: clean(result.text), tables: [] };
    }
    const html = buffer.toString("utf8");
    const $ = cheerio.load(html);
    $("script,style").remove();
    return { name, kind, text: clean($("body").text() || $.root().text()), tables: tablesFromHtml(html) };
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(400, "UNREADABLE_FILE", `Could not read "${name}": ${(e as Error).message}`);
  }
}
