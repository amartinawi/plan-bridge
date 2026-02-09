export type PlanStatus =
  | "submitted"
  | "in_progress"
  | "review_requested"
  | "needs_fixes"
  | "completed";

export interface Review {
  id: string;
  timestamp: string;
  findings: string[];
  status: "needs_fixes" | "approved";
}

export interface FixReport {
  id: string;
  timestamp: string;
  review_id: string;
  fixes_applied: string[];
}

export interface Plan {
  id: string;
  name: string;
  content: string;
  status: PlanStatus;
  source: string;
  project_path: string;
  created_at: string;
  updated_at: string;
  reviews: Review[];
  fix_reports: FixReport[];
}
