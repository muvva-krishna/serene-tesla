import { type PatchSuggestion, type TraceAutoevalResult, type TraceTree } from '../contracts/schemas.js';
import { evaluateTraceWithMastraScorers } from '../evals/scorers.js';
import {
  canonicalSha256,
  mean,
  percentile,
  wilsonConfidenceInterval,
  type WilsonInterval,
} from '../stats/wilson.js';
import {
  runSimulatedCodeVerificationFlow,
  runSimulatedMcpContactFlow,
  runSimulatedMemoryFlow,
  type RolloutPolicyMode,
} from './simulator.js';

export interface RolloutSuiteSummary {
  configId: RolloutPolicyMode;
  totalCases: number;
  passedCases: number;
  passRate: number;
  passRateCi95: WilsonInterval;
  meanAutoevalScore: number;
  meanTokens: number;
  p95DurationMs: number;
  meanSteps: number;
  results: TraceAutoevalResult[];
}

export type PromotionGateVerdict = 'PROMOTE' | 'HOLD' | 'REJECT';

export interface RolloutComparisonReport {
  baseline: RolloutSuiteSummary;
  candidate: RolloutSuiteSummary;
  appliedPatches: PatchSuggestion[];
  deltas: {
    passRateDelta: number;
    meanScoreDelta: number;
    meanTokensDelta: number;
    p95DurationMsDelta: number;
  };
  repeatabilityCheck: {
    passed: boolean;
    run1Hash: string;
    run2Hash: string;
  };
  gateVerdict: PromotionGateVerdict;
  gateReasons: string[];
}

function buildSuiteTraces(mode: RolloutPolicyMode, runTag: string): TraceTree[] {
  return [
    runSimulatedMcpContactFlow({
      traceId: `${runTag}-${mode}-mcp-1`,
      mode,
      firstName: 'Ada',
      lastName: 'Lovelace',
    }),
    runSimulatedMcpContactFlow({
      traceId: `${runTag}-${mode}-mcp-2`,
      mode,
      firstName: 'Grace',
      lastName: 'Hopper',
    }),
    runSimulatedCodeVerificationFlow({
      traceId: `${runTag}-${mode}-code-1`,
      mode,
      taskId: 'sympy-matrix-fix',
    }),
    runSimulatedCodeVerificationFlow({
      traceId: `${runTag}-${mode}-code-2`,
      mode,
      taskId: 'iris-data-loading-script',
    }),
    runSimulatedMemoryFlow({
      traceId: `${runTag}-${mode}-mem-1`,
      mode,
      taskId: 'relocation-update',
    }),
    runSimulatedMemoryFlow({
      traceId: `${runTag}-${mode}-mem-2`,
      mode,
      taskId: 'dietary-update',
    }),
  ];
}

async function evaluateSuite(
  mode: RolloutPolicyMode,
  runTag: string,
): Promise<RolloutSuiteSummary> {
  const traces = buildSuiteTraces(mode, runTag);
  const results = await Promise.all(
    traces.map(t => evaluateTraceWithMastraScorers(t)),
  );
  const passedCases = results.filter(r => r.passed).length;

  return {
    configId: mode,
    totalCases: results.length,
    passedCases,
    passRate: Number((passedCases / results.length).toFixed(4)),
    passRateCi95: wilsonConfidenceInterval(passedCases, results.length),
    meanAutoevalScore: Number(mean(results.map(r => r.overallScore)).toFixed(4)),
    meanTokens: Math.round(mean(results.map(r => r.metrics.totalTokens))),
    p95DurationMs: Math.round(percentile(results.map(r => r.metrics.durationMs), 95)),
    meanSteps: Number(mean(results.map(r => r.metrics.stepCount)).toFixed(2)),
    results,
  };
}

/**
 * Runs a paired baseline vs. candidate rollout, verifies deterministic repeatability
 * across two independent candidate runs (canonical SHA-256 comparison), and emits a
 * fail-closed promotion gate verdict.
 */
export async function runRolloutAndGate(
  appliedPatches: readonly PatchSuggestion[] = [],
): Promise<RolloutComparisonReport> {
  const baseline = await evaluateSuite('baseline', 'rollout-a');
  const candidate = await evaluateSuite('candidate_patched', 'rollout-a');
  const candidateRepeat = await evaluateSuite('candidate_patched', 'rollout-b');

  // Exclude run-tag traceId when verifying deterministic repeatability
  const exclude = new Set(['traceId']);
  const run1Hash = canonicalSha256(candidate, exclude);
  const run2Hash = canonicalSha256(candidateRepeat, exclude);
  const repeatabilityPassed = run1Hash === run2Hash;

  const passRateDelta = Number((candidate.passRate - baseline.passRate).toFixed(4));
  const meanScoreDelta = Number(
    (candidate.meanAutoevalScore - baseline.meanAutoevalScore).toFixed(4),
  );
  const meanTokensDelta = candidate.meanTokens - baseline.meanTokens;
  const p95DurationMsDelta = candidate.p95DurationMs - baseline.p95DurationMs;

  const gateReasons: string[] = [];
  let gateVerdict: PromotionGateVerdict = 'PROMOTE';

  if (!repeatabilityPassed) {
    gateVerdict = 'REJECT';
    gateReasons.push('Candidate rollout failed deterministic repeatability hash check.');
  }
  if (passRateDelta < 0 || meanScoreDelta < 0) {
    gateVerdict = 'REJECT';
    gateReasons.push('Candidate regressed pass rate or mean autoeval score vs. baseline.');
  } else if (passRateDelta === 0 && meanScoreDelta === 0) {
    gateVerdict = 'HOLD';
    gateReasons.push('Candidate showed zero improvement over baseline.');
  } else {
    gateReasons.push(
      `Pass rate improved by +${(passRateDelta * 100).toFixed(1)}% (${baseline.passedCases}/${baseline.totalCases} -> ${candidate.passedCases}/${candidate.totalCases}) with verified repeatability.`,
    );
  }

  return {
    baseline,
    candidate,
    appliedPatches: [...appliedPatches],
    deltas: {
      passRateDelta,
      meanScoreDelta,
      meanTokensDelta,
      p95DurationMsDelta,
    },
    repeatabilityCheck: {
      passed: repeatabilityPassed,
      run1Hash,
      run2Hash,
    },
    gateVerdict,
    gateReasons,
  };
}
