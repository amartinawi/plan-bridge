import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Plan, PlanStatus } from "./types.js";

const STORAGE_DIR = join(homedir(), ".plan-bridge", "plans");

export function ensureStorage(): void {
  mkdirSync(STORAGE_DIR, { recursive: true });
}

export function savePlan(plan: Plan): void {
  ensureStorage();
  const filePath = join(STORAGE_DIR, `${plan.id}.json`);
  writeFileSync(filePath, JSON.stringify(plan, null, 2), "utf-8");
}

export function loadPlan(id: string): Plan | null {
  const filePath = join(STORAGE_DIR, `${id}.json`);
  if (!existsSync(filePath)) return null;
  const data = readFileSync(filePath, "utf-8");
  return JSON.parse(data) as Plan;
}

export function listPlans(status?: PlanStatus): Plan[] {
  ensureStorage();
  const files = readdirSync(STORAGE_DIR).filter((f) => f.endsWith(".json"));
  const plans: Plan[] = [];
  for (const file of files) {
    const data = readFileSync(join(STORAGE_DIR, file), "utf-8");
    const plan = JSON.parse(data) as Plan;
    if (!status || plan.status === status) {
      plans.push(plan);
    }
  }
  return plans.sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
}

export function loadLatestPlan(status?: PlanStatus): Plan | null {
  const plans = listPlans(status);
  return plans.length > 0 ? plans[0] : null;
}
