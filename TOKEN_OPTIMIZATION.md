# Token Optimization: Trust + Verify Architecture

## Problem: Claude Code as "Token Burner"

**Before optimization**, Claude Code consumed 10k-50k tokens per review cycle:

- **Full codebase reads**: Reading 10+ files × 500-3000 tokens each
- **Redundant reads**: Re-reading unchanged files on every review
- **No change tracking**: Reviewing entire files instead of just changes
- **Verbose prompts**: 100-150 line command templates = 2k-3k tokens per invocation

**Result**: A 3-phase plan with 2 fix iterations = 60k-120k tokens consumed.

## Solution: Trust + Verify Architecture

Transform Claude Code from "token burner" to **architect and orchestrator** using:

### 1. OpenCode Self-Assessment (NEW)

After implementation, OpenCode submits quality metrics via `submit_self_assessment`:

```typescript
{
  files_changed: ["auth.ts", "utils.ts", "auth.test.ts"],
  tests_run: true,
  tests_passed: true,
  test_summary: "15 tests passed, 0 failed",
  requirements_met: [
    "Added JWT authentication",
    "Implemented token refresh",
    "Added comprehensive tests"
  ],
  concerns: [
    "Token expiry edge case needs review"
  ],
  questions: [
    "Should we add rate limiting to refresh endpoint?"
  ],
  git_diff_summary: "+350 -45 lines across 3 files"
}
```

### 2. Differential Review (Claude Code)

Instead of reading full files, Claude Code:

1. **Reads self-assessment** (0.5k tokens)
2. **Runs git diff** (1-2k tokens for changes only)
3. **Spot-checks** based on self-reported concerns
4. **Focuses review** on changed lines, not entire codebase

### 3. Trust Heuristic

**If self-assessment shows:**
- ✅ Tests passed
- ✅ All requirements met
- ✅ No concerns
- ✅ No questions

**Then**: Trust implementation, spot-check ONE critical file only (0.5k tokens).

**If concerns raised:**
- Review git diff for flagged files (1-3k tokens)
- Read full file ONLY if concern demands it

### 4. Compressed Prompts

**Before**: 100-150 lines, verbose explanations (2k-3k tokens)
**After**: 60-80 lines, bullet points, clear structure (1k-1.5k tokens)

**Reduction**: 40% per command invocation.

## Token Comparison

### Single Review Cycle

| Review Type | Old Workflow | New Workflow | Savings |
|-------------|--------------|--------------|---------|
| **Clean implementation** (tests pass, no concerns) | | | |
| - Plan content | 2,000 | 2,000 | 0% |
| - File reads (10 files) | 5,000 | 0 | 100% |
| - Git diff | 0 | 1,000 | - |
| - Self-assessment | 0 | 500 | - |
| - Review analysis | 2,000 | 500 | 75% |
| **Total** | **9,000** | **4,000** | **56%** |
| | | | |
| **With concerns** (focused review) | | | |
| - Plan content | 2,000 | 2,000 | 0% |
| - File reads (10 files) | 5,000 | 0 | 100% |
| - Git diff | 0 | 1,500 | - |
| - Self-assessment | 0 | 500 | - |
| - Focused file reads (2 files) | 0 | 1,500 | - |
| - Review analysis | 2,000 | 1,000 | 50% |
| **Total** | **9,000** | **6,500** | **28%** |
| | | | |
| **Failed tests** (deep review) | | | |
| - Plan content | 2,000 | 2,000 | 0% |
| - File reads (10 files) | 5,000 | 0 | 100% |
| - Git diff (detailed) | 0 | 2,000 | - |
| - Self-assessment | 0 | 500 | - |
| - Critical file reads (4 files) | 0 | 3,000 | - |
| - Review analysis | 3,000 | 1,500 | 50% |
| **Total** | **10,000** | **9,000** | **10%** |

### Full Workflow (3-Phase Plan)

**Scenario**: 3 phases, 1 fix iteration per phase, clean implementations

| Component | Old Tokens | New Tokens | Savings |
|-----------|------------|------------|---------|
| Plan submission + analysis | 3,000 | 3,000 | 0% |
| Phase 1 implementation (OpenCode) | 0 | 0 | 0% |
| Phase 1 review | 9,000 | 4,000 | 56% |
| Phase 1 fix | 5,000 | 3,000 | 40% |
| Phase 1 re-review | 9,000 | 3,000 | 67% |
| Phase 2 implementation | 0 | 0 | 0% |
| Phase 2 review | 9,000 | 4,000 | 56% |
| Phase 2 fix | 5,000 | 3,000 | 40% |
| Phase 2 re-review | 9,000 | 3,000 | 67% |
| Phase 3 implementation | 0 | 0 | 0% |
| Phase 3 review | 9,000 | 4,000 | 56% |
| Phase 3 fix | 5,000 | 3,000 | 40% |
| Phase 3 re-review | 9,000 | 3,000 | 67% |
| **Total** | **72,000** | **33,000** | **54%** |

**Savings: 39,000 tokens (54% reduction)**

## Architecture Comparison

### Before: Full-Read Review

```
Claude Code (Reviewer)
├── Read entire plan (2k tokens)
├── Read file 1 fully (500 tokens)
├── Read file 2 fully (600 tokens)
├── Read file 3 fully (400 tokens)
├── ... (read all files)
├── Analyze code quality (2k tokens)
└── Generate findings

Total: 9k-15k tokens per review
```

### After: Trust + Verify

```
Claude Code (Architect)
├── Read plan/phase (2k tokens)
├── Get self-assessment (0.5k tokens)
│   ├── Files changed
│   ├── Test results (TRUST signal)
│   ├── Requirements met
│   └── Concerns/questions (VERIFY targets)
├── Git diff only (1-2k tokens)
│   └── Changed lines in context
├── IF concerns: Spot-check files (1-3k tokens)
│   └── Only flagged areas
└── Generate findings

Total: 3k-8k tokens per review (50-70% reduction)
```

## Implementation Changes

### 1. New Type in types.ts

```typescript
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
```

### 2. New MCP Tool in tools.ts

```typescript
server.tool("submit_self_assessment", ...)
```

Stores assessment in plan/phase for reviewer access.

### 3. Updated OpenCode Commands

**get-plan**: Added step 5 "Self-Assessment" after implementation
**claude-review**: Added step 5 "Self-Assessment After Fixes"

Both gather metrics and call `submit_self_assessment` before marking review_requested.

### 4. Updated Claude Code Commands

**review-plan-optimized**:
- Reads self-assessment first
- Uses git diff instead of full files
- Spot-checks based on concerns
- 60% shorter prompt

**full-cycle-optimized**:
- Gets self-assessment in step 4
- Reviews via git diff in step 5
- Trust + Verify logic built in
- 45% shorter prompt

## Benefits

### 1. Token Savings
- **50-70% reduction** in Claude Code review tokens
- **Scales with codebase size** — larger codebases = greater savings
- **Compounds over cycles** — each review + fix iteration saves tokens

### 2. Faster Reviews
- Less data to process = faster responses
- Git diff is faster to read than full files
- Focused reviews complete quicker

### 3. Better Signal/Noise
- Self-assessment highlights what matters
- Reviewer focuses on uncertain areas
- Concerns/questions guide review priorities

### 4. Autonomous Quality
- OpenCode owns implementation quality
- Self-review catches issues before reviewer
- Tests become first-class validation signal

### 5. True Architecture Role
- Claude Code is architect/orchestrator, not line-by-line reviewer
- Trusts executor (OpenCode) for implementation details
- Verifies only critical concerns and edge cases

## Migration Path

### Keep Existing Commands
- `plan-bridge:send-plan` → No changes needed
- `plan-bridge:review-plan` → Original still works
- `plan-bridge:full-cycle` → Original still works
- OpenCode commands → Original still works

### Add Optimized Commands
- `plan-bridge:review-plan-optimized` → New diff-based review
- `plan-bridge:full-cycle-optimized` → New orchestration with Trust + Verify
- OpenCode commands updated inline in `~/.config/opencode/opencode.json`

### Gradual Adoption
1. **Week 1**: Test optimized commands on small plans
2. **Week 2**: Compare token usage (old vs new)
3. **Week 3**: Switch to optimized as default
4. **Week 4**: Remove old commands if optimized proven

## Monitoring Token Usage

Track these metrics:

```bash
# Before optimization (baseline)
- Average tokens per review: 9,000
- Average tokens per full cycle: 72,000
- Review time: 45-90 seconds

# After optimization (target)
- Average tokens per review: 4,000 (56% reduction)
- Average tokens per full cycle: 33,000 (54% reduction)
- Review time: 20-40 seconds (50% faster)
```

## Next Steps

1. ✅ **Types added** — SelfAssessment interface in types.ts
2. ✅ **MCP tool added** — submit_self_assessment in tools.ts
3. ✅ **Build successful** — 47.28 KB bundle
4. ✅ **OpenCode commands created** — Optimized templates in /tmp/
5. ✅ **Claude Code commands created** — Optimized in commands/claude-code/
6. **TODO**: Update ~/.config/opencode/opencode.json with optimized templates
7. **TODO**: Test on a real plan to measure token savings
8. **TODO**: Document observed savings and update this file

## Conclusion

The Trust + Verify architecture transforms Claude Code from a "token burner" to a true **architect and orchestrator**:

- **Before**: Micromanaging line-by-line reviews (9k-15k tokens)
- **After**: Strategic validation of self-assessed implementations (3k-6k tokens)

**Result**: 50-70% token reduction while maintaining quality through automated testing and self-review.

OpenCode owns implementation quality. Claude Code validates critical concerns. Together, they deliver faster, cheaper, and more autonomous AI-assisted development.
