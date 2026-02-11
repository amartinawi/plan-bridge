import { randomUUID } from "crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { savePlan, loadPlan, loadLatestPlan, listPlans, loadPhase, migratePlanToLocal as migrateToLocal } from "./storage.js";
import { analyzeComplexity, splitIntoPhases } from "./complexity.js";
import type { Plan, PlanStatus, Review, FixReport, Phase, SelfAssessment } from "./types.js";

export function registerTools(server: McpServer): void {
  // --- submit_plan ---
  server.tool(
    "submit_plan",
    "Submit a new implementation plan (legacy - use submit_phased_plan for complexity analysis)",
    {
      name: z.string().describe("Short plan name"),
      content: z.string().describe("Full plan content (markdown)"),
      project_path: z.string().describe("Absolute path to the project"),
      source: z.string().optional().describe("Who submitted: claude-code or opencode"),
      storage_mode: z
        .enum(["global", "local"])
        .optional()
        .describe("Storage mode (default: global for backward compatibility)"),
    },
    async ({ name, content, project_path, source, storage_mode }) => {
      const now = new Date().toISOString();
      const plan: Plan = {
        id: randomUUID(),
        name,
        content,
        status: "submitted",
        source: source ?? "claude-code",
        project_path,
        created_at: now,
        updated_at: now,
        reviews: [],
        fix_reports: [],
        self_assessments: [],
        storage_mode: storage_mode ?? "global", // Default to global for backward compatibility
        is_phased: false,
      };
      savePlan(plan);
      console.error(`[plan-bridge] ✅ Plan submitted: ${plan.id} (${plan.name}) by ${plan.source}`);
      console.error(`[plan-bridge] 📁 Project: ${plan.project_path}`);
      console.error(`[plan-bridge] 💾 Storage: ${plan.storage_mode}`);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ id: plan.id, status: plan.status, name: plan.name, storage_mode: plan.storage_mode }),
          },
        ],
      };
    }
  );

  // --- get_plan ---
  server.tool(
    "get_plan",
    "Get a plan by ID, or the latest plan optionally filtered by status",
    {
      id: z.string().optional().describe("Plan ID. If omitted, returns latest plan."),
      status: z
        .enum(["submitted", "in_progress", "review_requested", "needs_fixes", "completed"])
        .optional()
        .describe("Filter by status when fetching latest"),
      project_path: z
        .string()
        .optional()
        .describe("Project path for local storage lookup"),
    },
    async ({ id, status, project_path }) => {
      let plan: Plan | null;
      if (id) {
        plan = loadPlan(id, project_path);
      } else {
        plan = loadLatestPlan(status as PlanStatus | undefined, project_path);
      }
      if (!plan) {
        return { content: [{ type: "text" as const, text: "No plan found." }] };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(plan, null, 2) }],
      };
    }
  );

  // --- list_plans ---
  server.tool(
    "list_plans",
    "List all plans with optional status, project_path, and storage_mode filters",
    {
      status: z
        .enum(["submitted", "in_progress", "review_requested", "needs_fixes", "completed"])
        .optional()
        .describe("Filter by status"),
      project_path: z
        .string()
        .optional()
        .describe("Filter by project path"),
      storage_mode: z
        .enum(["global", "local"])
        .optional()
        .describe("Filter by storage mode"),
    },
    async ({ status, project_path, storage_mode }) => {
      const plans = listPlans(status as PlanStatus | undefined, project_path, storage_mode);
      const summary = plans.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        source: p.source,
        project_path: p.project_path,
        storage_mode: p.storage_mode,
        is_phased: p.is_phased,
        phase_count: p.phases?.length ?? 0,
        updated_at: p.updated_at,
        reviews_count: p.reviews.length,
        fix_reports_count: p.fix_reports.length,
      }));
      return {
        content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  // --- update_plan_status ---
  server.tool(
    "update_plan_status",
    "Update the status of a plan",
    {
      id: z.string().describe("Plan ID"),
      status: z
        .enum(["submitted", "in_progress", "review_requested", "needs_fixes", "completed"])
        .describe("New status"),
      project_path: z
        .string()
        .optional()
        .describe("Project path for local storage"),
    },
    async ({ id, status, project_path }) => {
      const plan = loadPlan(id, project_path);
      if (!plan) {
        return { content: [{ type: "text" as const, text: "Plan not found." }] };
      }
      const oldStatus = plan.status;
      plan.status = status as PlanStatus;
      plan.updated_at = new Date().toISOString();
      savePlan(plan);
      console.error(`[plan-bridge] 🔄 Status changed: ${plan.name} (${plan.id})`);
      console.error(`[plan-bridge]    ${oldStatus} → ${status}`);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ id: plan.id, status: plan.status }),
          },
        ],
      };
    }
  );

  // --- submit_review ---
  server.tool(
    "submit_review",
    "Submit a code review for a plan or current phase. Empty findings array means approved.",
    {
      plan_id: z.string().describe("Plan ID to review"),
      findings: z
        .array(z.string())
        .describe("List of findings. Empty array = approved."),
      project_path: z.string().optional().describe("Project path for local storage"),
    },
    async ({ plan_id, findings, project_path }) => {
      const plan = loadPlan(plan_id, project_path);
      if (!plan) {
        return { content: [{ type: "text" as const, text: "Plan not found." }] };
      }

      const approved = findings.length === 0;
      const review: Review = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        findings,
        status: approved ? "approved" : "needs_fixes",
      };

      // If phased, add review to current phase instead of plan
      if (plan.is_phased && plan.phases && plan.current_phase_id) {
        const currentPhase = plan.phases.find((p) => p.id === plan.current_phase_id);
        if (currentPhase) {
          currentPhase.reviews.push(review);
          currentPhase.status = approved ? "completed" : "needs_fixes";
          currentPhase.updated_at = new Date().toISOString();

          // If phase approved, update plan status to reflect phase completion
          if (approved) {
            // Check if this was the last phase
            const isLastPhase = currentPhase.phase_number === plan.phases.length;
            if (isLastPhase) {
              plan.status = "completed";
            } else {
              plan.status = "in_progress"; // More phases to go
            }
          } else {
            plan.status = "needs_fixes";
          }

          plan.updated_at = new Date().toISOString();
          savePlan(plan);

          if (approved) {
            console.error(`[plan-bridge] ✅ Phase ${currentPhase.phase_number} review approved: ${currentPhase.name}`);
            console.error(`[plan-bridge] 🎉 Phase completed with 0 findings`);
          } else {
            console.error(`[plan-bridge] 🔍 Phase ${currentPhase.phase_number} review submitted: ${currentPhase.name}`);
            console.error(`[plan-bridge] ⚠️  ${findings.length} finding(s) - status: needs_fixes`);
          }

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  review_id: review.id,
                  phase_number: currentPhase.phase_number,
                  phase_name: currentPhase.name,
                  phase_status: currentPhase.status,
                  plan_status: plan.status,
                  findings_count: findings.length,
                  approved,
                }),
              },
            ],
          };
        }
      }

      // Non-phased plan: add review to plan level
      plan.reviews.push(review);
      plan.status = approved ? "completed" : "needs_fixes";
      plan.updated_at = new Date().toISOString();
      savePlan(plan);

      if (approved) {
        console.error(`[plan-bridge] ✅ Review approved: ${plan.name} (${plan.id})`);
        console.error(`[plan-bridge] 🎉 Plan completed with 0 findings`);
      } else {
        console.error(`[plan-bridge] 🔍 Review submitted: ${plan.name} (${plan.id})`);
        console.error(`[plan-bridge] ⚠️  ${findings.length} finding(s) - status: needs_fixes`);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              review_id: review.id,
              plan_status: plan.status,
              findings_count: findings.length,
              approved,
            }),
          },
        ],
      };
    }
  );

  // --- get_review ---
  server.tool(
    "get_review",
    "Get the latest review for a plan or current phase",
    {
      plan_id: z.string().describe("Plan ID"),
      project_path: z.string().optional().describe("Project path for local storage"),
    },
    async ({ plan_id, project_path }) => {
      const plan = loadPlan(plan_id, project_path);
      if (!plan) {
        return { content: [{ type: "text" as const, text: "Plan not found." }] };
      }

      // If phased, get review from current phase
      if (plan.is_phased && plan.phases && plan.current_phase_id) {
        const currentPhase = plan.phases.find((p) => p.id === plan.current_phase_id);
        if (currentPhase) {
          if (currentPhase.reviews.length === 0) {
            return {
              content: [{ type: "text" as const, text: "No reviews yet for current phase." }],
            };
          }
          const latest = currentPhase.reviews[currentPhase.reviews.length - 1];
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    plan_id: plan.id,
                    phase_number: currentPhase.phase_number,
                    phase_name: currentPhase.name,
                    phase_status: currentPhase.status,
                    review: latest,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      }

      // Non-phased plan
      if (plan.reviews.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No reviews yet." }],
        };
      }
      const latest = plan.reviews[plan.reviews.length - 1];
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { plan_id: plan.id, plan_status: plan.status, review: latest },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // --- submit_fix_report ---
  server.tool(
    "submit_fix_report",
    "Report fixes applied for a review, auto-sets status to review_requested",
    {
      plan_id: z.string().describe("Plan ID"),
      review_id: z.string().describe("Review ID the fixes address"),
      fixes_applied: z.array(z.string()).describe("Description of each fix applied"),
      project_path: z.string().optional().describe("Project path for local storage"),
    },
    async ({ plan_id, review_id, fixes_applied, project_path }) => {
      const plan = loadPlan(plan_id, project_path);
      if (!plan) {
        return { content: [{ type: "text" as const, text: "Plan not found." }] };
      }

      const fixReport: FixReport = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        review_id,
        fixes_applied,
      };

      // If phased, add fix report to current phase
      if (plan.is_phased && plan.phases && plan.current_phase_id) {
        const currentPhase = plan.phases.find((p) => p.id === plan.current_phase_id);
        if (currentPhase) {
          currentPhase.fix_reports.push(fixReport);
          currentPhase.status = "review_requested";
          currentPhase.updated_at = new Date().toISOString();
          plan.status = "review_requested";
          plan.updated_at = new Date().toISOString();
          savePlan(plan);

          console.error(`[plan-bridge] 🔧 Fixes submitted for phase ${currentPhase.phase_number}: ${currentPhase.name}`);
          console.error(`[plan-bridge] ✓ ${fixes_applied.length} fix(es) applied - requesting re-review`);

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  fix_report_id: fixReport.id,
                  phase_number: currentPhase.phase_number,
                  phase_status: currentPhase.status,
                  plan_status: plan.status,
                  fixes_count: fixes_applied.length,
                }),
              },
            ],
          };
        }
      }

      // Non-phased plan
      plan.fix_reports.push(fixReport);
      plan.status = "review_requested";
      plan.updated_at = new Date().toISOString();
      savePlan(plan);

      console.error(`[plan-bridge] 🔧 Fixes submitted: ${plan.name} (${plan.id})`);
      console.error(`[plan-bridge] ✓ ${fixes_applied.length} fix(es) applied - requesting re-review`);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              fix_report_id: fixReport.id,
              plan_status: plan.status,
              fixes_count: fixes_applied.length,
            }),
          },
        ],
      };
    }
  );

  // --- mark_complete ---
  server.tool(
    "mark_complete",
    "Force-mark a plan as completed",
    {
      id: z.string().describe("Plan ID"),
      project_path: z.string().optional().describe("Project path for local storage"),
    },
    async ({ id, project_path }) => {
      const plan = loadPlan(id, project_path);
      if (!plan) {
        return { content: [{ type: "text" as const, text: "Plan not found." }] };
      }
      plan.status = "completed";
      plan.updated_at = new Date().toISOString();
      savePlan(plan);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ id: plan.id, status: "completed" }),
          },
        ],
      };
    }
  );

  // --- wait_for_status ---
  server.tool(
    "wait_for_status",
    "Poll a plan until it reaches the target status. Blocks up to timeout_seconds (default 1200). Used to automate the review loop — one side waits for the other to finish.",
    {
      plan_id: z.string().describe("Plan ID to watch"),
      target_status: z
        .enum(["submitted", "in_progress", "review_requested", "needs_fixes", "completed"])
        .describe("Status to wait for"),
      timeout_seconds: z
        .number()
        .optional()
        .describe("Max seconds to wait (default 1200)"),
      project_path: z
        .string()
        .optional()
        .describe("Project path for local storage lookup"),
    },
    async ({ plan_id, target_status, timeout_seconds, project_path }) => {
      const timeout = (timeout_seconds ?? 1200) * 1000;
      const pollInterval = 5000;
      const startTime = Date.now();
      const plan = loadPlan(plan_id, project_path);
      if (!plan) {
        return { content: [{ type: "text" as const, text: "Plan not found." }] };
      }

      console.error(`[plan-bridge] ⏳ Waiting for status: ${plan.name} (${plan.id})`);
      console.error(`[plan-bridge]    Current: ${plan.status} → Target: ${target_status}`);
      console.error(`[plan-bridge]    Timeout: ${timeout_seconds ?? 1200}s (polling every 5s)`);

      let lastLoggedStatus = plan.status;
      while (Date.now() - startTime < timeout) {
        const currentPlan = loadPlan(plan_id, project_path);
        if (!currentPlan) {
          return { content: [{ type: "text" as const, text: "Plan not found." }] };
        }

        // Log status changes while waiting
        if (currentPlan.status !== lastLoggedStatus) {
          console.error(`[plan-bridge] 🔄 Status update: ${lastLoggedStatus} → ${currentPlan.status}`);
          lastLoggedStatus = currentPlan.status;
        }

        if (currentPlan.status === target_status) {
          const waitedSeconds = Math.round((Date.now() - startTime) / 1000);
          console.error(`[plan-bridge] ✅ Target status reached after ${waitedSeconds}s`);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  reached: true,
                  plan_id: currentPlan.id,
                  status: currentPlan.status,
                  waited_seconds: waitedSeconds,
                }),
              },
            ],
          };
        }
        // If plan is already completed, stop waiting
        if (currentPlan.status === "completed") {
          console.error(`[plan-bridge] ⚠️  Plan already completed, stopping wait`);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  reached: false,
                  plan_id: currentPlan.id,
                  status: currentPlan.status,
                  message: "Plan already completed.",
                }),
              },
            ],
          };
        }
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
      const finalPlan = loadPlan(plan_id, project_path);
      console.error(`[plan-bridge] ⏰ Timeout after ${timeout_seconds ?? 1200}s`);
      console.error(`[plan-bridge]    Final status: ${finalPlan?.status}`);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              reached: false,
              message: `Timeout after ${timeout_seconds ?? 1200}s. Plan status is still: ${finalPlan?.status}`,
            }),
          },
        ],
      };
    }
  );

  // --- analyze_plan_complexity ---
  server.tool(
    "analyze_plan_complexity",
    "Analyze plan content to determine complexity and get phase recommendations",
    {
      content: z.string().describe("Plan content to analyze (markdown)"),
    },
    async ({ content }) => {
      const analysis = analyzeComplexity(content);
      console.error(`[plan-bridge] 🔍 Complexity analysis complete`);
      console.error(`[plan-bridge]    Score: ${analysis.score}/100 ${analysis.is_complex ? "(COMPLEX)" : "(SIMPLE)"}`);
      console.error(`[plan-bridge]    Files: ${analysis.indicators.file_count}, Steps: ${analysis.indicators.estimated_steps}`);
      if (analysis.is_complex) {
        console.error(`[plan-bridge]    Recommended phases: ${analysis.recommended_phases.length}`);
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(analysis, null, 2),
          },
        ],
      };
    }
  );

  // --- submit_phased_plan ---
  server.tool(
    "submit_phased_plan",
    "Submit a new plan with automatic complexity analysis and phase splitting",
    {
      name: z.string().describe("Short plan name"),
      content: z.string().describe("Full plan content (markdown)"),
      project_path: z.string().describe("Absolute path to the project"),
      source: z.string().optional().describe("Who submitted: claude-code or opencode"),
      storage_mode: z
        .enum(["global", "local"])
        .optional()
        .describe("Storage mode (default: local)"),
      force_phased: z
        .boolean()
        .optional()
        .describe("Force phase splitting even if not complex"),
    },
    async ({ name, content, project_path, source, storage_mode, force_phased }) => {
      const now = new Date().toISOString();

      // Analyze complexity
      const analysis = analyzeComplexity(content);

      // Create base plan
      let plan: Plan = {
        id: randomUUID(),
        name,
        content,
        status: "submitted",
        source: source ?? "claude-code",
        project_path,
        created_at: now,
        updated_at: now,
        reviews: [],
        fix_reports: [],
        self_assessments: [],
        storage_mode: storage_mode ?? "local",
        is_phased: false,
      };

      // Split into phases if complex or forced
      if (analysis.is_complex || force_phased) {
        plan = splitIntoPhases(plan, analysis);
      }

      savePlan(plan);

      console.error(`[plan-bridge] ✅ Plan submitted: ${plan.id} (${plan.name}) by ${plan.source}`);
      console.error(`[plan-bridge] 📁 Project: ${plan.project_path}`);
      console.error(`[plan-bridge] 💾 Storage: ${plan.storage_mode}`);
      console.error(`[plan-bridge] 📊 Complexity: ${analysis.score}/100 ${analysis.is_complex ? "(COMPLEX)" : "(SIMPLE)"}`);
      if (plan.is_phased && plan.phases) {
        console.error(`[plan-bridge] 📑 Phases: ${plan.phases.length}`);
        plan.phases.forEach((p) => {
          console.error(`[plan-bridge]    Phase ${p.phase_number}: ${p.name}`);
        });
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              id: plan.id,
              status: plan.status,
              name: plan.name,
              storage_mode: plan.storage_mode,
              is_phased: plan.is_phased,
              phase_count: plan.phases?.length ?? 0,
              complexity_score: analysis.score,
            }),
          },
        ],
      };
    }
  );

  // --- get_current_phase ---
  server.tool(
    "get_current_phase",
    "Get the current active phase for a phased plan",
    {
      plan_id: z.string().describe("Plan ID"),
      project_path: z.string().optional().describe("Project path for local storage"),
    },
    async ({ plan_id, project_path }) => {
      const plan = loadPlan(plan_id, project_path);
      if (!plan) {
        return { content: [{ type: "text" as const, text: "Plan not found." }] };
      }

      if (!plan.is_phased || !plan.phases) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                is_phased: false,
                message: "This plan is not split into phases.",
              }),
            },
          ],
        };
      }

      const currentPhase = plan.phases.find((p) => p.id === plan.current_phase_id);
      if (!currentPhase) {
        return { content: [{ type: "text" as const, text: "Current phase not found." }] };
      }

      const phasePosition = `${currentPhase.phase_number}/${plan.phases.length}`;
      console.error(`[plan-bridge] 📑 Current phase: ${currentPhase.name} (${phasePosition})`);
      console.error(`[plan-bridge]    Status: ${currentPhase.status}`);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                plan_id: plan.id,
                plan_name: plan.name,
                total_phases: plan.phases.length,
                current_phase: currentPhase,
                phase_position: phasePosition,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // --- advance_to_next_phase ---
  server.tool(
    "advance_to_next_phase",
    "Mark current phase as completed and advance to next phase",
    {
      plan_id: z.string().describe("Plan ID"),
      project_path: z.string().optional().describe("Project path for local storage"),
    },
    async ({ plan_id, project_path }) => {
      const plan = loadPlan(plan_id, project_path);
      if (!plan) {
        return { content: [{ type: "text" as const, text: "Plan not found." }] };
      }

      if (!plan.is_phased || !plan.phases) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                message: "This plan is not split into phases.",
              }),
            },
          ],
        };
      }

      const currentPhase = plan.phases.find((p) => p.id === plan.current_phase_id);
      if (!currentPhase) {
        return { content: [{ type: "text" as const, text: "Current phase not found." }] };
      }

      // Mark current phase as completed
      currentPhase.status = "completed";
      currentPhase.updated_at = new Date().toISOString();

      // Find next phase
      const nextPhase = plan.phases.find(
        (p) => p.phase_number === currentPhase.phase_number + 1
      );

      if (nextPhase) {
        // Advance to next phase
        plan.current_phase_id = nextPhase.id;
        plan.updated_at = new Date().toISOString();
        savePlan(plan);

        console.error(`[plan-bridge] ✅ Phase ${currentPhase.phase_number} completed: ${currentPhase.name}`);
        console.error(`[plan-bridge] ➡️  Advanced to phase ${nextPhase.phase_number}: ${nextPhase.name}`);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                completed_phase: currentPhase.phase_number,
                completed_phase_name: currentPhase.name,
                current_phase: nextPhase.phase_number,
                current_phase_name: nextPhase.name,
                remaining_phases: plan.phases.length - nextPhase.phase_number,
              }),
            },
          ],
        };
      } else {
        // No more phases - mark plan as completed
        plan.status = "completed";
        plan.updated_at = new Date().toISOString();
        savePlan(plan);

        console.error(`[plan-bridge] ✅ Phase ${currentPhase.phase_number} completed: ${currentPhase.name}`);
        console.error(`[plan-bridge] 🎉 All phases completed! Plan marked as completed.`);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                completed_phase: currentPhase.phase_number,
                completed_phase_name: currentPhase.name,
                all_phases_completed: true,
                plan_status: "completed",
              }),
            },
          ],
        };
      }
    }
  );

  // --- list_plan_phases ---
  server.tool(
    "list_plan_phases",
    "List all phases for a phased plan with status summary",
    {
      plan_id: z.string().describe("Plan ID"),
      project_path: z.string().optional().describe("Project path for local storage"),
    },
    async ({ plan_id, project_path }) => {
      const plan = loadPlan(plan_id, project_path);
      if (!plan) {
        return { content: [{ type: "text" as const, text: "Plan not found." }] };
      }

      if (!plan.is_phased || !plan.phases) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                is_phased: false,
                message: "This plan is not split into phases.",
              }),
            },
          ],
        };
      }

      const phaseSummary = plan.phases.map((p) => ({
        phase_number: p.phase_number,
        id: p.id,
        name: p.name,
        status: p.status,
        is_current: p.id === plan.current_phase_id,
        reviews_count: p.reviews.length,
        fix_reports_count: p.fix_reports.length,
      }));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                plan_id: plan.id,
                plan_name: plan.name,
                total_phases: plan.phases.length,
                phases: phaseSummary,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // --- reset_plan ---
  server.tool(
    "reset_plan",
    "Reset a plan (and all its phases) back to 'submitted' status, clearing all reviews and fix reports. Use this to re-run a plan through the full cycle.",
    {
      plan_id: z.string().describe("Plan ID to reset"),
      project_path: z.string().optional().describe("Project path for local storage"),
    },
    async ({ plan_id, project_path }) => {
      const plan = loadPlan(plan_id, project_path);
      if (!plan) {
        return { content: [{ type: "text" as const, text: "Plan not found." }] };
      }

      const oldStatus = plan.status;
      plan.status = "submitted";
      plan.reviews = [];
      plan.fix_reports = [];
      plan.updated_at = new Date().toISOString();

      // Reset all phases if phased
      if (plan.is_phased && plan.phases) {
        for (const phase of plan.phases) {
          phase.status = "submitted";
          phase.reviews = [];
          phase.fix_reports = [];
          phase.updated_at = new Date().toISOString();
        }
        // Reset current phase to first phase
        plan.current_phase_id = plan.phases[0]?.id;
      }

      savePlan(plan);

      const phasesReset = plan.phases?.length ?? 0;
      console.error(`[plan-bridge] 🔄 Plan reset: ${plan.name} (${plan.id})`);
      console.error(`[plan-bridge]    ${oldStatus} → submitted`);
      if (phasesReset > 0) {
        console.error(`[plan-bridge]    ${phasesReset} phases reset to submitted`);
      }
      console.error(`[plan-bridge]    Reviews and fix reports cleared`);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              plan_id: plan.id,
              plan_name: plan.name,
              old_status: oldStatus,
              new_status: "submitted",
              phases_reset: phasesReset,
              current_phase: plan.phases?.[0]?.name ?? null,
            }),
          },
        ],
      };
    }
  );

  // --- migrate_plan_to_local ---
  server.tool(
    "migrate_plan_to_local",
    "Migrate a global plan to local storage in a specific project",
    {
      plan_id: z.string().describe("Plan ID to migrate"),
      target_project_path: z.string().describe("Target project path for local storage"),
    },
    async ({ plan_id, target_project_path }) => {
      const migratedPlan = migrateToLocal(plan_id, target_project_path);
      if (!migratedPlan) {
        return { content: [{ type: "text" as const, text: "Plan not found or migration failed." }] };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              plan_id: migratedPlan.id,
              storage_mode: migratedPlan.storage_mode,
              project_path: migratedPlan.project_path,
            }),
          },
        ],
      };
    }
  );

  // --- submit_self_assessment ---
  server.tool(
    "submit_self_assessment",
    "Submit self-assessment after implementation (OpenCode reports quality, tests, concerns)",
    {
      plan_id: z.string().describe("Plan ID"),
      project_path: z.string().describe("Project path for local storage lookup"),
      files_changed: z.array(z.string()).describe("List of files modified"),
      tests_run: z.boolean().describe("Whether tests were executed"),
      tests_passed: z.boolean().describe("Whether all tests passed"),
      test_summary: z.string().optional().describe("Test results summary"),
      requirements_met: z.array(z.string()).describe("Which requirements were implemented"),
      concerns: z.array(z.string()).describe("Any concerns or issues encountered"),
      questions: z.array(z.string()).describe("Questions for reviewer"),
      git_diff_summary: z.string().describe("Summary of git diff (lines added/removed)"),
    },
    async ({
      plan_id,
      project_path,
      files_changed,
      tests_run,
      tests_passed,
      test_summary,
      requirements_met,
      concerns,
      questions,
      git_diff_summary,
    }) => {
      const plan = loadPlan(plan_id, project_path);
      if (!plan) {
        return { content: [{ type: "text" as const, text: "Plan not found." }] };
      }

      const assessment: SelfAssessment = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        phase_or_plan_id: plan.is_phased && plan.current_phase_id ? plan.current_phase_id : plan_id,
        files_changed,
        tests_run,
        tests_passed,
        test_summary,
        requirements_met,
        concerns,
        questions,
        git_diff_summary,
      };

      // Add to current phase if phased, otherwise to plan
      if (plan.is_phased && plan.phases && plan.current_phase_id) {
        const currentPhase = plan.phases.find((p) => p.id === plan.current_phase_id);
        if (currentPhase) {
          currentPhase.self_assessments.push(assessment);
          console.error(`[plan-bridge] 📊 Self-assessment received for phase ${currentPhase.phase_number}`);
        }
      } else {
        plan.self_assessments.push(assessment);
        console.error(`[plan-bridge] 📊 Self-assessment received for plan ${plan.name}`);
      }

      plan.updated_at = new Date().toISOString();
      savePlan(plan);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              assessment_id: assessment.id,
              files_changed: files_changed.length,
              tests_passed,
              concerns_count: concerns.length,
              questions_count: questions.length,
            }),
          },
        ],
      };
    }
  );
}
