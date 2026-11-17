import { createScorer } from '@mastra/core/evals';
import { z } from 'zod';
import {
  type FailureFinding,
  type TraceAutoevalResult,
  type TraceTree,
} from '../contracts/schemas.js';
import {
  DEFAULT_DETECTOR_THRESHOLDS,
  detectBudgetAndLatencyAnomaly,
  detectCascadeToolFailure,
  detectMemoryStaleOrMiss,
  detectSpecificationGaming,
  detectStaleRefDesync,
  detectToolThrashLoop,
  type DetectorThresholds,
} from '../trace-intel/detectors.js';

const traceInputSchema = z.object({
  taskId: z.string(),
  expectedOutcome: z.string().nullable().optional(),
});

const traceOutputSchema = z.object({
  traceTree: z.custom<TraceTree>(),
  thresholds: z.custom<DetectorThresholds>().optional(),
});

function clamp01(n: number): number {
  return Number(Math.max(0, Math.min(1, n)).toFixed(4));
}

function penaltyFromFindings(findings: readonly FailureFinding[]): number {
  let penalty = 0;
  for (const f of findings) {
    if (f.severity === 'critical') penalty += 0.65;
    else if (f.severity === 'warning') penalty += 0.3;
    else penalty += 0.1;
  }
  return Math.min(1, penalty);
}

/**
 * MastraScorer 1: Trace structural invariants & unrecovered error cascade.
 */
export const traceInvariantsScorer = createScorer({
  id: 'trace-invariants',
  name: 'Trace Invariants Scorer',
  description:
    'Verifies span parent-child continuity (zero orphans) and detects unrecovered tool/MCP error cascades.',
  type: { input: traceInputSchema, output: traceOutputSchema },
})
  .analyze(({ run }) => {
    const tree = run.output.traceTree;
    const cascadeFindings = detectCascadeToolFailure(tree);
    const orphanPenalty = tree.orphanSpanIds.length > 0 ? 0.25 : 0;
    const findings: FailureFinding[] = [...cascadeFindings];
    return { findings, orphanPenalty };
  })
  .generateScore(({ results }) => {
    const { findings, orphanPenalty } = results.analyzeStepResult;
    return clamp01(1 - penaltyFromFindings(findings) - orphanPenalty);
  })
  .generateReason(({ results, score }) => {
    const { findings } = results.analyzeStepResult;
    if (findings.length === 0 && score === 1) {
      return 'All trace spans are structurally connected with zero unrecovered tool errors.';
    }
    return findings.map(f => f.explanation).join(' | ') || `Score ${score} due to orphan spans.`;
  });

/**
 * MastraScorer 2: Tool-call efficiency & accessibility-tree ref discipline.
 */
export const toolCallEfficiencyScorer = createScorer({
  id: 'tool-call-efficiency',
  name: 'Tool Call Efficiency & Ref Discipline Scorer',
  description:
    'Detects tool thrash loops, agent-device stale accessibility ref usage, and step/token/TTFT anomalies.',
  type: { input: traceInputSchema, output: traceOutputSchema },
})
  .analyze(({ run }) => {
    const tree = run.output.traceTree;
    const thresholds = run.output.thresholds ?? DEFAULT_DETECTOR_THRESHOLDS;
    const findings: FailureFinding[] = [
      ...detectToolThrashLoop(tree, thresholds),
      ...detectStaleRefDesync(tree),
      ...detectBudgetAndLatencyAnomaly(tree, thresholds),
    ];
    return { findings };
  })
  .generateScore(({ results }) => {
    return clamp01(1 - penaltyFromFindings(results.analyzeStepResult.findings));
  })
  .generateReason(({ results }) => {
    const { findings } = results.analyzeStepResult;
    return findings.length === 0
      ? 'Tool execution path is efficient with fresh UI refs and within latency/token budgets.'
      : findings.map(f => `[${f.code}] ${f.explanation}`).join(' | ');
  });

/**
 * MastraScorer 3: Trajectory integrity (anti-reward-hacking & verification fidelity).
 */
export const trajectoryIntegrityScorer = createScorer({
  id: 'trajectory-integrity',
  name: 'Trajectory Integrity Scorer',
  description:
    'Detects specification gaming, skipped verification gates, and unverified completion claims.',
  type: { input: traceInputSchema, output: traceOutputSchema },
})
  .analyze(({ run }) => {
    const findings = detectSpecificationGaming(run.output.traceTree);
    return { findings };
  })
  .generateScore(({ results }) => {
    return clamp01(1 - penaltyFromFindings(results.analyzeStepResult.findings));
  })
  .generateReason(({ results }) => {
    const { findings } = results.analyzeStepResult;
    return findings.length === 0
      ? 'No specification-gaming or verification-bypass signals detected.'
      : findings.map(f => f.explanation).join(' | ');
  });

/**
 * MastraScorer 4: Grounding & Memory correctness.
 */
export const groundingAndMemoryScorer = createScorer({
  id: 'grounding-and-memory',
  name: 'Grounding & Memory Scorer',
  description:
    'Evaluates memory recall freshness, knowledge-update consistency, temporal ordering, and abstention discipline.',
  type: { input: traceInputSchema, output: traceOutputSchema },
})
  .analyze(({ run }) => {
    const findings = detectMemoryStaleOrMiss(run.output.traceTree);
    return { findings };
  })
  .generateScore(({ results }) => {
    return clamp01(1 - penaltyFromFindings(results.analyzeStepResult.findings));
  })
  .generateReason(({ results }) => {
    const { findings } = results.analyzeStepResult;
    return findings.length === 0
      ? 'Memory retrieval and grounding signals passed without stale facts or abstention errors.'
      : findings.map(f => f.explanation).join(' | ');
  });

/**
 * Runs all 4 @mastra/core MastraScorers over a TraceTree and aggregates
 * findings, per-dimension scores, and pass/fail verdict.
 */
export async function evaluateTraceWithMastraScorers(
  tree: TraceTree,
  thresholds: DetectorThresholds = DEFAULT_DETECTOR_THRESHOLDS,
): Promise<TraceAutoevalResult> {
  const input = { taskId: tree.taskId, expectedOutcome: tree.expectedOutcome };
  const output = { traceTree: tree, thresholds };

  const [inv, eff, intg, mem] = await Promise.all([
    traceInvariantsScorer.run({ input, output }),
    toolCallEfficiencyScorer.run({ input, output }),
    trajectoryIntegrityScorer.run({ input, output }),
    groundingAndMemoryScorer.run({ input, output }),
  ]);

  const invScore = inv.score ?? 0;
  const effScore = eff.score ?? 0;
  const intgScore = intg.score ?? 0;
  const memScore = mem.score ?? 0;

  const findings: FailureFinding[] = [
    ...(inv.analyzeStepResult?.findings ?? []),
    ...(eff.analyzeStepResult?.findings ?? []),
    ...(intg.analyzeStepResult?.findings ?? []),
    ...(mem.analyzeStepResult?.findings ?? []),
  ];

  // Weighted aggregate score, plus hard-fail if any critical finding occurred
  const weighted = clamp01(
    0.2 * invScore + 0.3 * effScore + 0.3 * intgScore + 0.2 * memScore,
  );
  const hasCritical = findings.some(f => f.severity === 'critical');
  const passed = !hasCritical && weighted >= 0.75;

  return {
    traceId: tree.traceId,
    taskId: tree.taskId,
    configId: tree.configId,
    overallScore: weighted,
    passed,
    scorerBreakdown: {
      traceInvariants: invScore,
      toolCallEfficiency: effScore,
      trajectoryIntegrity: intgScore,
      groundingAndMemory: memScore,
    },
    findings,
    metrics: {
      stepCount: tree.stepCount,
      toolCallCount: tree.toolCallCount,
      totalTokens: tree.totalTokens,
      durationMs: tree.totalDurationMs,
      errorCount: tree.errorCount,
    },
  };
}
