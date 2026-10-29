import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { ApiError, fail, ok } from "./envelope.js";
import { configFromRequest, generateJson, type LlmConfig } from "./llm.js";
import { generateSpec } from "./pipeline.js";
import { renderSpec } from "./render.js";
import { validationReportHtml } from "./report.js";
import { readDocument } from "./docs.js";
import { extractSpec, extractCos, extractUnitsFromBlueprint } from "./extract.js";
import { bloomFromStatement } from "./bloom.js";
import {
  actionsFor,
  addComment,
  assertCanComment,
  assertCanEdit,
  createSpec,
  getSpec,
  listSpecs,
  parseRole,
  transition,
  type SpecRecord,
} from "./store.js";

const app = express();
app.use(express.json({ limit: "10mb" }));

const api = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const files = upload.fields([
  { name: "spec", maxCount: 1 },
  { name: "blueprint", maxCount: 1 },
]);

api.get("/health", (_req, res) => ok(res, { status: "up" }));

// "Test key" button in Settings. Proves the key and model work, nothing more.
api.get("/llm-check", async (req, res, next) => {
  try {
    const cfg = configFromRequest(req);
    const out = await generateJson('Return exactly {"pong": true}', z.object({ pong: z.boolean() }), cfg);
    ok(res, { provider: cfg.provider, model: cfg.model, reply: out });
  } catch (e) {
    next(e);
  }
});

/** The AI config when the browser sent a key, otherwise null so the rules still run. */
function optionalLlm(req: Request): LlmConfig | null {
  try {
    return configFromRequest(req);
  } catch {
    return null;
  }
}

type UploadedFiles = Record<string, Express.Multer.File[] | undefined>;

function filesFrom(req: Request) {
  const bag = (req.files ?? {}) as UploadedFiles;
  const spec = bag.spec?.[0];
  if (!spec) throw new ApiError(400, "SPEC_REQUIRED", "Upload the existing course specification in the 'spec' field.");
  return { spec, blueprint: bag.blueprint?.[0] ?? null };
}

const publicSpec = (record: SpecRecord, role: ReturnType<typeof parseRole>) => ({
  id: record.id,
  status: record.status,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  output: record.output,
  defects: record.defects,
  signals: record.signals,
  notes: record.notes,
  aiUsed: record.aiUsed,
  log: record.log,
  comments: record.comments,
  actions: actionsFor(record, role),
  canEdit: role === "Author" && (record.status === "Draft" || record.status === "Returned"),
});

// Level 1: read the documents and show what was found, without correcting anything.
api.post("/parse", files, async (req, res, next) => {
  try {
    const { spec, blueprint } = filesFrom(req);
    const specDoc = await readDocument(spec.buffer, spec.originalname);
    const parsedSpec = extractSpec(specDoc);
    let blueprintData = null;
    if (blueprint) {
      const bpDoc = await readDocument(blueprint.buffer, blueprint.originalname);
      blueprintData = { cos: extractCos(bpDoc), units: extractUnitsFromBlueprint(bpDoc) };
    }
    ok(res, {
      spec: {
        header: parsedSpec.header,
        credits: parsedSpec.credits,
        summary: parsedSpec.summary,
        cos: parsedSpec.cos.map((c) => ({ ...c, bloom_level: bloomFromStatement(c.statement) })),
        units: parsedSpec.units,
        map: parsedSpec.map,
        hours: parsedSpec.hours,
        assessment: parsedSpec.assessment,
        extraSections: parsedSpec.extraSections,
      },
      blueprint: blueprintData,
    });
  } catch (e) {
    next(e);
  }
});

// The scorer's route: files in, the output object and the filled document out, no clicks.
api.post("/generate", files, async (req, res, next) => {
  try {
    const { spec, blueprint } = filesFrom(req);
    const override = (() => {
      const template = String(req.body?.template ?? "").trim();
      const reason = String(req.body?.template_reason ?? "").trim();
      if (template !== "integrated" && template !== "non_lab") return null;
      if (!reason) throw new ApiError(400, "REASON_REQUIRED", "A template override needs a reason.");
      return { template, reason } as const;
    })();
    const result = await generateSpec({
      spec: { buffer: spec.buffer, name: spec.originalname },
      blueprint: blueprint ? { buffer: blueprint.buffer, name: blueprint.originalname } : null,
      llm: optionalLlm(req),
      templateOverride: override,
    });
    const record = createSpec({
      output: result.output,
      html: result.html,
      render: result.render,
      defects: result.defects,
      signals: result.signals,
      notes: result.notes,
      aiUsed: result.aiUsed,
    });
    ok(res, {
      output: result.output,
      html: result.html,
      spec_id: record.id,
      defects: result.defects,
      signals: result.signals,
      notes: result.notes,
      ai_used: result.aiUsed,
    });
  } catch (e) {
    next(e);
  }
});

api.get("/specs", (req, res, next) => {
  try {
    const role = parseRole(req.header("x-role"));
    ok(res, { specs: listSpecs().map((r) => ({ id: r.id, status: r.status, code: r.output.course.code, title: r.output.course.title, updatedAt: r.updatedAt, defects: r.defects.length, actions: actionsFor(r, role) })) });
  } catch (e) {
    next(e);
  }
});

api.get("/specs/:id", (req, res, next) => {
  try {
    const role = parseRole(req.header("x-role"));
    ok(res, publicSpec(getSpec(req.params.id), role));
  } catch (e) {
    next(e);
  }
});

const editSchema = z
  .object({
    summary: z.string().min(10).optional(),
    outcomes: z.array(z.object({ id: z.string().regex(/^CO-\d+$/), statement: z.string().min(5).optional(), bloom_level: z.number().int().min(1).max(6).optional() })).optional(),
    cells: z
      .array(
        z.object({
          co: z.string().regex(/^CO-\d+$/),
          column: z.string().regex(/^(PO-([1-9]|1[01])|PSO-\d+)$/),
          level: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
          justification: z.string().min(5).optional(),
        }),
      )
      .optional(),
  })
  .strict();

// Author edits. The server refuses every other role and every other state.
api.patch("/specs/:id", (req, res, next) => {
  try {
    const role = parseRole(req.header("x-role"));
    const record = getSpec(req.params.id);
    assertCanEdit(record, role);
    const body = editSchema.parse(req.body ?? {});
    if (body.summary) record.output.course.summary = body.summary.trim();
    for (const edit of body.outcomes ?? []) {
      const co = record.output.course_outcomes.find((c) => c.id === edit.id);
      if (!co) throw new ApiError(404, "NO_SUCH_CO", `${edit.id} is not in this spec.`);
      if (edit.statement) co.statement = edit.statement.trim();
      if (edit.bloom_level) co.bloom_level = edit.bloom_level;
    }
    for (const edit of body.cells ?? []) {
      const row = (record.output.co_po_pso_map[edit.co] ??= {});
      if (edit.level === 0) delete row[edit.column];
      else row[edit.column] = { level: edit.level, justification: edit.justification?.trim() || `Set by the Author: ${edit.co} supports ${edit.column}.` };
    }
    record.html = renderSpec({ output: record.output, ...record.render, status: record.status });
    record.updatedAt = new Date().toISOString();
    record.log.push({ at: record.updatedAt, role, user: `${role.toLowerCase()}@specforge.local`, action: "edited", from: record.status, to: record.status, comment: null });
    ok(res, publicSpec(record, role));
  } catch (e) {
    next(e);
  }
});

api.post("/specs/:id/transition", (req, res, next) => {
  try {
    const role = parseRole(req.header("x-role"));
    const record = getSpec(req.params.id);
    const action = String(req.body?.action ?? "");
    const comment = req.body?.comment ? String(req.body.comment) : null;
    transition(record, role, action, comment);
    record.html = renderSpec({ output: record.output, ...record.render, status: record.status });
    ok(res, publicSpec(record, role));
  } catch (e) {
    next(e);
  }
});

api.post("/specs/:id/comments", (req, res, next) => {
  try {
    const role = parseRole(req.header("x-role"));
    assertCanComment(role);
    const record = getSpec(req.params.id);
    const text = String(req.body?.text ?? "").trim();
    if (!text) throw new ApiError(400, "TEXT_REQUIRED", "A comment needs some text.");
    const sectionRaw = req.body?.section;
    const section = sectionRaw === null || sectionRaw === undefined || sectionRaw === "" ? null : Number(sectionRaw);
    if (section !== null && (!Number.isInteger(section) || section < 1 || section > 12)) {
      throw new ApiError(400, "BAD_SECTION", "A comment's section must be a number from 1 to 12.");
    }
    ok(res, addComment(record, role, section, text));
  } catch (e) {
    next(e);
  }
});

api.get("/specs/:id/spec.html", (req, res, next) => {
  try {
    const record = getSpec(req.params.id);
    res.type("html").send(record.html);
  } catch (e) {
    next(e);
  }
});

api.get("/specs/:id/report.html", (req, res, next) => {
  try {
    const record = getSpec(req.params.id);
    res.type("html").send(validationReportHtml(record.output, record.defects, record.notes, record.signals));
  } catch (e) {
    next(e);
  }
});

api.get("/specs/:id/output.json", (req, res, next) => {
  try {
    const record = getSpec(req.params.id);
    res.type("json").send(JSON.stringify(record.output, null, 2));
  } catch (e) {
    next(e);
  }
});

app.use("/api/v1", api);
app.use("/api", (_req, res) => fail(res, 404, "NOT_FOUND", "No such route"));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) return fail(res, err.status, err.code, err.message);
  if (err instanceof z.ZodError) return fail(res, 400, "BAD_INPUT", err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  console.error("Unhandled:", err instanceof Error ? err.message : "unknown error"); // never log headers or keys
  fail(res, 500, "SERVER_ERROR", "Something went wrong on the server.");
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`API on http://localhost:${port}/api/v1`));
