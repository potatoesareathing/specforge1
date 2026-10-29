# SpecForge

A web app that reads a messy university course specification (plus an optional question-paper
blueprint) and produces a corrected specification in the official HTML template, with a re-derived
CO-PO-PSO map, a rule-based validation report, and an Author → Reviewer → HOD approval workflow.

It also writes `outputs/specforge_output.json`, the scoring file.

## How to run

```bash
npm install
npm run dev         # web on http://localhost:5173, API on http://localhost:3001
```

Open http://localhost:5173, press **Settings**, choose a provider (Gemini, OpenRouter or Anthropic),
paste your own API key and press **Test key**. The key is stored in your browser only and is sent to
the backend in the `x-llm-*` headers for a single request at a time. It is never written to disk,
logged, returned or committed.

Then upload the existing spec (required) and the blueprint (optional) and press
**Generate corrected spec**.

Other commands:

```bash
npm start           # API only on port 3001, what the scorer runs
npm run typecheck   # TypeScript, no emit
npm run check       # validates outputs/specforge_output.json against the official schema
npm run audit       # checks outputs/spec.html against the output file (sections, sample text, map)
npm run verify -- gemini YOUR_KEY    # the scorer's own call against your running app
```

## The scoring route

`POST /api/v1/generate` takes multipart fields `spec` (required) and `blueprint` (optional) plus the
`x-llm-provider`, `x-llm-key` and `x-llm-model` headers, runs the whole pipeline with no clicks, and
replies with:

```json
{ "success": true, "data": { "output": { ... }, "html": "<the filled spec document>" } }
```

If the AI provider is unavailable or rate-limited, the pipeline still returns a complete, valid
result from the rule-based path.

## How it works

| Stage | File | What it does |
| --- | --- | --- |
| Read | `server/docs.ts` | `.docx` (mammoth), `.doc` (word-extractor), `.pdf` (pdf-parse), `.html` (cheerio) into text and table rows |
| Extract | `server/extract.ts` | header, credits, COs, units, the existing map, teaching hours, assessment and resources, found by document labels |
| Bloom | `server/bloom.ts` | Bloom level from the CO's leading verb, using the verb table in `config/po_pso.json` |
| Map | `server/mapping.ts` | re-derives every CO-PO-PSO cell from the Bloom ceiling plus evidence in the syllabus and assessment, one justification per cell, then clamps anything that breaks a rule |
| Validate | `server/validate.ts` | V1 to V10 in plain code; only defects a rule can prove are reported |
| Render | `server/render.ts` | fills `templates/*.html`, keeping headings, numbering, tables, CSS and the PDF button; adds the DRAFT watermark until approval |
| Workflow | `server/store.ts` | roles, the six workflow states, comments and the audit log, all enforced on the server |

Source-of-truth rules: course outcomes and the unit syllabus come from the blueprint when one is
supplied, everything else from the existing spec; the Integrated template is used when the credit
structure has a practical component or the course type mentions a laboratory, otherwise Non-Lab,
with a manual override that requires a reason.

## Roles

| Role | Can do | Cannot do |
| --- | --- | --- |
| Author | upload, generate, edit content in Draft or Returned, submit | approve |
| Reviewer | read, comment per section, forward to HOD, return to Author | edit content |
| HOD | read, approve, return to Author | edit content |

Every permission is checked on the server; a Reviewer or HOD edit returns HTTP 403.

## AI tools used

- **Claude Code (Claude Opus 5)** — used as the coding assistant for this project.
- The app itself calls the provider the user configures in Settings (Gemini, OpenRouter or
  Anthropic) through `server/llm.ts` only, for the summary rewrite and a review pass over the map.

## Track

Coder track (own editor with AI assistance), built from the SpecForge starter template.
