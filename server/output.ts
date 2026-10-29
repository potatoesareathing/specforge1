// The scoring file. The Zod schema here mirrors config/specforge_output.schema.json,
// so anything that leaves this module is already in the shape the scorer accepts.
import { z } from "zod";

export const DEFECT_CODES = [
  "CO_MISSING_IN_TABLE",
  "CO_EXTRA_IN_TABLE",
  "CO_ASSESSMENT_MISMATCH",
  "PSO_COLUMN_MISMATCH",
  "MAPPING_BLOOM_MISMATCH",
  "MAPPING_UNSUPPORTED",
  "WRONG_TEMPLATE",
  "PLACEHOLDER_TEXT",
  "SUMMARY_SYLLABUS_MISMATCH",
  "LABEL_OR_TITLE_MISMATCH",
  "HOURS_INCONSISTENT",
  "WEIGHTAGE_INCONSISTENT",
  "TYPO_OR_FORMAT",
  "SECTION_NOT_IN_TEMPLATE",
  "MARKS_INCONSISTENT",
  "OTHER",
] as const;

const cell = z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]), justification: z.string().min(1) }).strict();

export const outputSchema = z
  .object({
    schema_version: z.literal("1.0"),
    input_id: z.string().min(1),
    template: z.enum(["integrated", "non_lab"]),
    course: z
      .object({
        title: z.string().min(1),
        code: z.string().min(1),
        department: z.string().min(1),
        credits_ltp: z.string().regex(/^\d+:\d+:\d+$/),
        course_type: z.string().min(1),
        summary: z.string().min(1),
      })
      .strict(),
    course_outcomes: z
      .array(
        z
          .object({ id: z.string().regex(/^CO-\d+$/), statement: z.string().min(1), bloom_level: z.number().int().min(1).max(6) })
          .strict(),
      )
      .min(1),
    units: z.array(z.object({ number: z.number().int(), title: z.string().min(1), lab: z.string().nullable() }).strict()),
    co_po_pso_map: z.record(z.string().regex(/^CO-\d+$/), z.record(z.string().regex(/^(PO-([1-9]|1[01])|PSO-\d+)$/), cell)),
    teaching_hours: z.object({ lectures: z.number(), lab: z.number(), tests_exams: z.number(), total: z.number() }).strict(),
    assessment: z
      .object({
        components: z.array(z.object({ name: z.string().min(1), weight_percent: z.number() }).strict()),
        co_coverage: z.record(z.string().regex(/^CO-\d+$/), z.array(z.string())),
      })
      .strict(),
    defects: z
      .array(
        z
          .object({
            code: z.enum(DEFECT_CODES),
            location: z
              .object({
                source: z.enum(["spec", "blueprint", "template"]),
                section: z.number().int().min(1).max(12).nullable(),
                refs: z.array(z.string()),
              })
              .strict(),
            description: z.string().min(1),
            fix: z.string().min(1),
          })
          .strict(),
      ),
  })
  .strict();

export type SpecForgeOutput = z.infer<typeof outputSchema>;
