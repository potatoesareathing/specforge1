export type Cell = { level: 1 | 2 | 3; justification: string };

export type SpecOutput = {
  schema_version: "1.0";
  input_id: string;
  template: "integrated" | "non_lab";
  course: { title: string; code: string; department: string; credits_ltp: string; course_type: string; summary: string };
  course_outcomes: { id: string; statement: string; bloom_level: number }[];
  units: { number: number; title: string; lab: string | null }[];
  co_po_pso_map: Record<string, Record<string, Cell>>;
  teaching_hours: { lectures: number; lab: number; tests_exams: number; total: number };
  assessment: { components: { name: string; weight_percent: number }[]; co_coverage: Record<string, string[]> };
  defects: { code: string; location: { source: string; section: number | null; refs: string[] }; description: string; fix: string }[];
};

export type Defect = {
  code: string;
  location: { source: string; section: number | null; refs: string[] };
  description: string;
  fix: string;
  severity: "High" | "Medium" | "Low";
  rule?: string;
};

export type State = "Draft" | "Submitted" | "Under Review" | "Pending HOD" | "Approved" | "Returned";

export type LogEntry = { at: string; role: string; user: string; action: string; from: State; to: State; comment: string | null };
export type Comment = { id: string; at: string; role: string; user: string; section: number | null; text: string };

export type SpecView = {
  id: string;
  status: State;
  createdAt: string;
  updatedAt: string;
  output: SpecOutput;
  defects: Defect[];
  signals: string[];
  notes: string[];
  aiUsed: boolean;
  log: LogEntry[];
  comments: Comment[];
  actions: string[];
  canEdit: boolean;
};

export type GenerateReply = {
  output: SpecOutput;
  html: string;
  spec_id: string;
  defects: Defect[];
  signals: string[];
  notes: string[];
  ai_used: boolean;
};

export type SpecSummary = { id: string; status: State; code: string; title: string; updatedAt: string; defects: number; actions: string[] };

export const PO_COLUMNS = [
  "PO-1", "PO-2", "PO-3", "PO-4", "PO-5", "PO-6", "PO-7", "PO-8", "PO-9", "PO-10", "PO-11", "PSO-1", "PSO-2",
];

export const BLOOM_NAMES: Record<number, string> = {
  1: "Remember", 2: "Understand", 3: "Apply", 4: "Analyse", 5: "Evaluate", 6: "Create",
};

export const WORKFLOW: State[] = ["Draft", "Submitted", "Under Review", "Pending HOD", "Approved"];
