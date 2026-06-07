export type EntityStatus =
  | "active"
  | "archived"
  | "planning"
  | "running"
  | "blocked"
  | "review"
  | "done"
  | "draft"
  | "ready"
  | "queued"
  | "failed";

export interface Division {
  id: string;
  name: string;
  description: string;
  leadWorkerId?: string;
  status: "active" | "archived";
}

export interface Campaign {
  id: string;
  divisionId: string;
  title: string;
  summary: string;
  pmWorkerId?: string;
  status: "planning" | "running" | "blocked" | "review" | "done" | "archived";
  currentFocus?: string;
  health: "normal" | "needs_owner_decision" | "blocked" | "failing";
}
