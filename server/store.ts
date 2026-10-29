// In-memory store for generated specs, the approval workflow and the audit log.
// Roles come from the role switcher; every permission is decided here, on the server.
import { ApiError } from "./envelope.js";
import type { Defect } from "./validate.js";
import type { SpecForgeOutput } from "./output.js";

export const ROLES = ["Author", "Reviewer", "HOD"] as const;
export type Role = (typeof ROLES)[number];

export const STATES = ["Draft", "Submitted", "Under Review", "Pending HOD", "Approved", "Returned"] as const;
export type State = (typeof STATES)[number];

export type LogEntry = { at: string; role: Role; user: string; action: string; from: State; to: State; comment: string | null };
export type Comment = { id: string; at: string; role: Role; user: string; section: number | null; text: string };

/** What renderSpec needs besides the output object, kept so edits can re-render. */
export type RenderSource = {
  units: { number: number; title: string; content: string; lab: string | null }[];
  credits: { number: string | null; weeks: string | null; marks: number | null; faculty: string | null };
  resources: Record<string, string[]>;
};

export type SpecRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: State;
  output: SpecForgeOutput;
  html: string;
  render: RenderSource;
  defects: Defect[];
  signals: string[];
  notes: string[];
  aiUsed: boolean;
  log: LogEntry[];
  comments: Comment[];
};

const specs = new Map<string, SpecRecord>();
let counter = 0;

const now = () => new Date().toISOString();
export const userFor = (role: Role) => `${role.toLowerCase()}@specforge.local`;

export function parseRole(value: unknown): Role {
  const text = String(value ?? "Author").trim().toLowerCase();
  const role = ROLES.find((r) => r.toLowerCase() === text);
  if (!role) throw new ApiError(400, "BAD_ROLE", `Choose one of ${ROLES.join(", ")}.`);
  return role;
}

export function createSpec(data: Omit<SpecRecord, "id" | "createdAt" | "updatedAt" | "status" | "log" | "comments">): SpecRecord {
  counter += 1;
  const id = `spec-${counter}`;
  const record: SpecRecord = {
    ...data,
    id,
    createdAt: now(),
    updatedAt: now(),
    status: "Draft",
    log: [{ at: now(), role: "Author", user: userFor("Author"), action: "generated", from: "Draft", to: "Draft", comment: null }],
    comments: [],
  };
  specs.set(id, record);
  return record;
}

export function listSpecs(): SpecRecord[] {
  return [...specs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getSpec(id: string): SpecRecord {
  const record = specs.get(id);
  if (!record) throw new ApiError(404, "NOT_FOUND", `No spec with id ${id}.`);
  return record;
}

/** Only the Author may change content, and only while the spec is open for editing. */
export function assertCanEdit(record: SpecRecord, role: Role) {
  if (role !== "Author") throw new ApiError(403, "NOT_PERMITTED", `${role} cannot edit content. Only the Author can.`);
  if (record.status !== "Draft" && record.status !== "Returned") {
    throw new ApiError(403, "NOT_EDITABLE", `A spec in "${record.status}" cannot be edited. It must be Returned to the Author first.`);
  }
}

export function assertCanComment(role: Role) {
  if (role === "Author") throw new ApiError(403, "NOT_PERMITTED", "Comments are added by the Reviewer or the HOD.");
}

type Transition = { action: string; role: Role; from: State[]; to: State; needsComment?: boolean };

export const TRANSITIONS: Transition[] = [
  { action: "submit", role: "Author", from: ["Draft", "Returned"], to: "Submitted" },
  { action: "open", role: "Reviewer", from: ["Submitted"], to: "Under Review" },
  { action: "forward", role: "Reviewer", from: ["Under Review"], to: "Pending HOD" },
  { action: "return", role: "Reviewer", from: ["Submitted", "Under Review"], to: "Returned", needsComment: true },
  { action: "approve", role: "HOD", from: ["Pending HOD"], to: "Approved" },
  { action: "return", role: "HOD", from: ["Pending HOD", "Under Review"], to: "Returned", needsComment: true },
];

export function transition(record: SpecRecord, role: Role, action: string, comment: string | null): SpecRecord {
  const candidates = TRANSITIONS.filter((t) => t.action === action);
  if (!candidates.length) throw new ApiError(400, "BAD_ACTION", `Unknown action "${action}".`);
  const allowed = candidates.filter((t) => t.role === role);
  if (!allowed.length) throw new ApiError(403, "NOT_PERMITTED", `${role} cannot ${action} a spec.`);
  const move = allowed.find((t) => t.from.includes(record.status));
  if (!move) {
    throw new ApiError(403, "BAD_STATE", `${role} cannot ${action} a spec in "${record.status}".`);
  }
  if (move.needsComment && !comment?.trim()) throw new ApiError(400, "COMMENT_REQUIRED", "Add a comment explaining what to change.");
  const from = record.status;
  record.status = move.to;
  record.updatedAt = now();
  record.log.push({ at: now(), role, user: userFor(role), action, from, to: move.to, comment: comment?.trim() || null });
  return record;
}

export function addComment(record: SpecRecord, role: Role, section: number | null, text: string): Comment {
  const comment: Comment = { id: `c-${record.comments.length + 1}`, at: now(), role, user: userFor(role), section, text: text.trim() };
  record.comments.push(comment);
  record.updatedAt = now();
  return comment;
}

/** What each role may do with this spec right now, for the screen to show. */
export function actionsFor(record: SpecRecord, role: Role): string[] {
  return TRANSITIONS.filter((t) => t.role === role && t.from.includes(record.status)).map((t) => t.action);
}
