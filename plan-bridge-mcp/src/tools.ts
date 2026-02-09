import { randomUUID } from "crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { savePlan, loadPlan, loadLatestPlan, listPlans } from "./storage.js";
import type { Plan, PlanStatus, Review, FixReport } from "./types.js";

export function registerTools(server: McpServer): void {
  // --- submit_plan ---
  server.tool(
    "submit_plan",
    "Submit a new implementation plan",
    {
      name: z.string().describe("Short plan name"),
      content: z.string().describe("Full plan content (markdown)"),
      project_path: z.string().describe("Absolute path to the project"),
      source: z.string().optional().describe("Who submitted: claude-code or opencode"),
    },
    async ({ name, content, project_path, source }) => {
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
      };
      savePlan(plan);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ id: plan.id, status: plan.status, name: plan.name }),
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
    },
    async ({ id, status }) => {
      let plan: Plan | null;
      if (id) {
        plan = loadPlan(id);
      } else {
        plan = loadLatestPlan(status as PlanStatus | undefined);
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
    "List all plans with optional status and project_path filters",
    {
      status: z
        .enum(["submitted", "in_progress", "review_requested", "needs_fixes", "completed"])
        .optional()
        .describe("Filter by status"),
      project_path: z
        .string()
        .optional()
        .describe("Filter by project path"),
    },
    async ({ status, project_path }) => {
      let plans = listPlans(status as PlanStatus | undefined);
      if (project_path) {
        plans = plans.filter((p) => p.project_path === project_path);
      }
      const summary = plans.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        source: p.source,
        project_path: p.project_path,
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
    },
    async ({ id, status }) => {
      const plan = loadPlan(id);
      if (!plan) {
        return { content: [{ type: "text" as const, text: "Plan not found." }] };
      }
      plan.status = status as PlanStatus;
      plan.updated_at = new Date().toISOString();
      savePlan(plan);
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
    "Submit a code review for a plan. Empty findings array means approved.",
    {
      plan_id: z.string().describe("Plan ID to review"),
      findings: z
        .array(z.string())
        .describe("List of findings. Empty array = approved."),
    },
    async ({ plan_id, findings }) => {
      const plan = loadPlan(plan_id);
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
      plan.reviews.push(review);
      plan.status = approved ? "completed" : "needs_fixes";
      plan.updated_at = new Date().toISOString();
      savePlan(plan);
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
    "Get the latest review for a plan",
    {
      plan_id: z.string().describe("Plan ID"),
    },
    async ({ plan_id }) => {
      const plan = loadPlan(plan_id);
      if (!plan) {
        return { content: [{ type: "text" as const, text: "Plan not found." }] };
      }
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
    },
    async ({ plan_id, review_id, fixes_applied }) => {
      const plan = loadPlan(plan_id);
      if (!plan) {
        return { content: [{ type: "text" as const, text: "Plan not found." }] };
      }
      const fixReport: FixReport = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        review_id,
        fixes_applied,
      };
      plan.fix_reports.push(fixReport);
      plan.status = "review_requested";
      plan.updated_at = new Date().toISOString();
      savePlan(plan);
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
    },
    async ({ id }) => {
      const plan = loadPlan(id);
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
    "Poll a plan until it reaches the target status. Blocks up to timeout_seconds (default 300). Used to automate the review loop — one side waits for the other to finish.",
    {
      plan_id: z.string().describe("Plan ID to watch"),
      target_status: z
        .enum(["submitted", "in_progress", "review_requested", "needs_fixes", "completed"])
        .describe("Status to wait for"),
      timeout_seconds: z
        .number()
        .optional()
        .describe("Max seconds to wait (default 300)"),
    },
    async ({ plan_id, target_status, timeout_seconds }) => {
      const timeout = (timeout_seconds ?? 300) * 1000;
      const pollInterval = 5000;
      const startTime = Date.now();

      while (Date.now() - startTime < timeout) {
        const plan = loadPlan(plan_id);
        if (!plan) {
          return { content: [{ type: "text" as const, text: "Plan not found." }] };
        }
        if (plan.status === target_status) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  reached: true,
                  plan_id: plan.id,
                  status: plan.status,
                  waited_seconds: Math.round((Date.now() - startTime) / 1000),
                }),
              },
            ],
          };
        }
        // If plan is already completed, stop waiting
        if (plan.status === "completed") {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  reached: false,
                  plan_id: plan.id,
                  status: plan.status,
                  message: "Plan already completed.",
                }),
              },
            ],
          };
        }
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
      }
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              reached: false,
              message: `Timeout after ${timeout_seconds ?? 300}s. Plan status is still: ${loadPlan(plan_id)?.status}`,
            }),
          },
        ],
      };
    }
  );
}
