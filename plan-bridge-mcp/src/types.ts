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

export interface SelfAssessment {
  id: string;
  timestamp: string;
  phase_or_plan_id: string;
  files_changed: string[];
  tests_run: boolean;
  tests_passed: boolean;
  test_summary?: string;
  requirements_met: string[];
  concerns: string[];
  questions: string[];
  git_diff_summary: string;
}

export interface Phase {
  id: string;
  phase_number: number;
  name: string;
  description: string;
  dependencies: string[];
  content: string;
  status: PlanStatus;
  reviews: Review[];
  fix_reports: FixReport[];
  self_assessments: SelfAssessment[];
  created_at: string;
  updated_at: string;
}

export interface PhaseRecommendation {
  name: string;
  description: string;
  estimated_files: string[];
  rationale: string;
}

export interface ComplexityAnalysis {
  is_complex: boolean;
  score: number;
  indicators: {
    file_count: number;
    has_phases: boolean;
    has_dependencies: boolean;
    estimated_steps: number;
    total_lines: number;
  };
  recommended_phases: PhaseRecommendation[];
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
  self_assessments: SelfAssessment[];
  storage_mode: "global" | "local";
  is_phased: boolean;
  phases?: Phase[];
  current_phase_id?: string;
}
