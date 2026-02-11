import { randomUUID } from "crypto";
import type { ComplexityAnalysis, PhaseRecommendation, Phase, Plan } from "./types.js";

/**
 * Analyzes plan content to determine if it's complex enough to warrant phase splitting
 */
export function analyzeComplexity(content: string): ComplexityAnalysis {
  const lines = content.split("\n");
  const totalLines = lines.length;

  // Count file references (common patterns: file.ts, path/to/file.js, `filename.ext`)
  const filePatterns = [
    /[\w-]+\.(ts|js|tsx|jsx|json|md|html|css|py|go|rs|java|cpp|c|h)/g,
    /`[\w-/]+\.[\w]+`/g,
    /\*\*File:\*\*\s*`?[\w-/.]+`?/gi,
  ];
  const fileMatches = new Set<string>();
  for (const pattern of filePatterns) {
    const matches = content.match(pattern);
    if (matches) {
      matches.forEach((m) => fileMatches.add(m));
    }
  }
  const fileCount = fileMatches.size;

  // Detect phase-related keywords
  const phaseKeywords = [
    /phase\s+\d+/gi,
    /step\s+\d+/gi,
    /stage\s+\d+/gi,
    /part\s+\d+/gi,
    /##\s+(phase|step|stage|part)/gi,
  ];
  const hasPhases = phaseKeywords.some((pattern) => pattern.test(content));

  // Detect dependency keywords
  const dependencyKeywords = [
    /depend(s|encies|ency)/gi,
    /require(s|ments|ment)/gi,
    /prerequisite/gi,
    /after.*complete/gi,
    /before.*start/gi,
  ];
  const hasDependencies = dependencyKeywords.some((pattern) => pattern.test(content));

  // Count estimated steps (numbered lists, task lists, bullet points with action verbs)
  const stepPatterns = [
    /^\s*\d+\.\s+/gm, // Numbered lists
    /^\s*-\s+\[[ x]\]\s+/gm, // Task lists
    /^\s*[-*]\s+(Add|Create|Implement|Update|Fix|Remove|Refactor|Test)/gm, // Action items
  ];
  let estimatedSteps = 0;
  for (const pattern of stepPatterns) {
    const matches = content.match(pattern);
    if (matches) estimatedSteps += matches.length;
  }

  // Calculate complexity score (0-100)
  let score = 0;
  score += Math.min(fileCount * 5, 40); // Up to 40 points for file count (8+ files = max)
  score += hasPhases ? 15 : 0;
  score += hasDependencies ? 10 : 0;
  score += Math.min(estimatedSteps * 2, 20); // Up to 20 points for steps (10+ steps = max)
  score += Math.min(totalLines / 10, 15); // Up to 15 points for length (150+ lines = max)

  // Determine if complex (threshold: score >= 50 or fileCount >= 5)
  const isComplex = score >= 50 || fileCount >= 5;

  // Generate phase recommendations if complex
  const recommendedPhases: PhaseRecommendation[] = isComplex
    ? generatePhaseRecommendations(content, fileCount)
    : [];

  return {
    is_complex: isComplex,
    score: Math.round(score),
    indicators: {
      file_count: fileCount,
      has_phases: hasPhases,
      has_dependencies: hasDependencies,
      estimated_steps: estimatedSteps,
      total_lines: totalLines,
    },
    recommended_phases: recommendedPhases,
  };
}

/**
 * Generates phase recommendations based on content structure
 */
function generatePhaseRecommendations(
  content: string,
  fileCount: number
): PhaseRecommendation[] {
  const recommendations: PhaseRecommendation[] = [];

  // Check if content already has explicit phases
  const explicitPhases = extractExplicitPhases(content);
  if (explicitPhases.length > 0) {
    return explicitPhases;
  }

  // Otherwise, generate standard phases based on content patterns
  const sections = content.split(/^##\s+/gm).filter((s) => s.trim());

  // Standard phase structure for most projects
  const hasSetup = /setup|install|config|init/gi.test(content);
  const hasCore = /implement|core|main|feature|logic/gi.test(content);
  const hasTesting = /test|spec|coverage|qa/gi.test(content);
  const hasDocs = /document|readme|guide|wiki/gi.test(content);

  if (hasSetup) {
    recommendations.push({
      name: "Setup & Configuration",
      description: "Initialize project structure, install dependencies, configure tooling",
      estimated_files: extractFilesFromPattern(content, /(setup|config|package\.json|tsconfig)/gi),
      rationale: "Foundation must be established before feature implementation",
    });
  }

  if (hasCore || fileCount >= 3) {
    recommendations.push({
      name: "Core Implementation",
      description: "Implement main features, business logic, and primary functionality",
      estimated_files: extractFilesFromPattern(content, /\.(ts|js|tsx|jsx|py|go|rs)/g),
      rationale: "Primary functionality forms the bulk of the implementation",
    });
  }

  if (hasTesting) {
    recommendations.push({
      name: "Testing & Validation",
      description: "Write tests, add coverage, validate behavior",
      estimated_files: extractFilesFromPattern(content, /(test|spec|__tests__|\.test\.|\.spec\.)/gi),
      rationale: "Testing requires completed implementation to verify",
    });
  }

  if (hasDocs) {
    recommendations.push({
      name: "Documentation",
      description: "Update README, write guides, document API",
      estimated_files: extractFilesFromPattern(content, /(readme|docs?|guide|wiki)/gi),
      rationale: "Documentation reflects final implementation details",
    });
  }

  // If no specific patterns detected, create generic phases based on sections
  if (recommendations.length === 0 && sections.length > 2) {
    sections.slice(0, 4).forEach((section, idx) => {
      const title = section.split("\n")[0].trim();
      recommendations.push({
        name: title || `Phase ${idx + 1}`,
        description: section.slice(0, 200).trim(),
        estimated_files: extractFilesFromPattern(section, /[\w-/]+\.(ts|js|tsx|jsx|json|md)/g),
        rationale: `Based on plan structure section ${idx + 1}`,
      });
    });
  }

  return recommendations;
}

/**
 * Extracts explicitly defined phases from content (e.g., "## Phase 1: Setup")
 */
function extractExplicitPhases(content: string): PhaseRecommendation[] {
  const phases: PhaseRecommendation[] = [];
  const phasePattern = /^##\s+(Phase|Step|Stage)\s+(\d+)[:\s]+(.+)$/gim;
  let match;

  while ((match = phasePattern.exec(content)) !== null) {
    const phaseName = match[3].trim();
    const phaseNumber = parseInt(match[2], 10);
    const startIndex = match.index;
    const nextPhaseMatch = content.slice(startIndex + 1).search(/^##\s+(Phase|Step|Stage)\s+\d+/im);
    const endIndex = nextPhaseMatch === -1 ? content.length : startIndex + nextPhaseMatch + 1;
    const phaseContent = content.slice(startIndex, endIndex);

    phases.push({
      name: phaseName,
      description: phaseContent.slice(0, 300).trim(),
      estimated_files: extractFilesFromPattern(phaseContent, /[\w-/]+\.(ts|js|tsx|jsx|json|md)/g),
      rationale: `Explicitly defined in plan as Phase ${phaseNumber}`,
    });
  }

  return phases;
}

/**
 * Extracts file references matching a pattern from content
 */
function extractFilesFromPattern(content: string, pattern: RegExp): string[] {
  const matches = content.match(pattern);
  if (!matches) return [];
  return Array.from(new Set(matches)).slice(0, 5); // Limit to 5 files per phase
}

/**
 * Splits a plan into phases based on complexity analysis
 */
export function splitIntoPhases(plan: Plan, analysis: ComplexityAnalysis): Plan {
  if (!analysis.is_complex || analysis.recommended_phases.length === 0) {
    // Not complex enough to split
    return { ...plan, is_phased: false };
  }

  const phases: Phase[] = analysis.recommended_phases.map((rec, idx) => {
    const phaseNumber = idx + 1;
    const dependencies = idx > 0 ? [analysis.recommended_phases[idx - 1].name] : [];

    return {
      id: randomUUID(),
      phase_number: phaseNumber,
      name: rec.name,
      description: rec.description,
      dependencies,
      content: extractPhaseContent(plan.content, rec, idx, analysis.recommended_phases.length),
      status: "submitted",
      reviews: [],
      fix_reports: [],
      self_assessments: [],
      created_at: plan.created_at,
      updated_at: plan.updated_at,
    };
  });

  return {
    ...plan,
    is_phased: true,
    phases,
    current_phase_id: phases[0]?.id,
  };
}

/**
 * Extracts content relevant to a specific phase from the full plan
 */
function extractPhaseContent(
  fullContent: string,
  recommendation: PhaseRecommendation,
  phaseIndex: number,
  totalPhases: number
): string {
  // Try to find explicit phase section in content
  const phasePattern = new RegExp(
    `^##\\s+(Phase|Step|Stage)\\s+${phaseIndex + 1}[:\\s]+`,
    "gim"
  );
  const match = fullContent.match(phasePattern);

  if (match) {
    // Extract content between this phase header and next
    const startIndex = fullContent.indexOf(match[0]);
    const nextPhasePattern = new RegExp(
      `^##\\s+(Phase|Step|Stage)\\s+${phaseIndex + 2}[:\\s]+`,
      "gim"
    );
    const nextMatch = fullContent.slice(startIndex + 1).match(nextPhasePattern);
    const endIndex = nextMatch
      ? startIndex + fullContent.slice(startIndex).indexOf(nextMatch[0])
      : fullContent.length;

    return fullContent.slice(startIndex, endIndex).trim();
  }

  // Otherwise, create a phase-specific summary
  return `# ${recommendation.name}

${recommendation.description}

## Files to Modify
${recommendation.estimated_files.map((f) => `- ${f}`).join("\n")}

## Rationale
${recommendation.rationale}

## Implementation Details
Refer to the full plan for detailed implementation guidance. Focus on:
- ${recommendation.name}
- Files: ${recommendation.estimated_files.join(", ")}

## Full Plan Context
See parent plan for complete requirements and architecture.
`;
}
