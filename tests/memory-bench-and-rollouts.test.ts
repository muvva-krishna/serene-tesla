import { describe, expect, it } from 'vitest';
import { buildCuratedBaselineTraces } from '../src/benchmarks/datasets.js';
import { runMemoryPrimitiveBenchmark } from '../src/benchmarks/memory-bench.js';
import { evaluateTraceWithMastraScorers } from '../src/evals/scorers.js';
import { runRolloutAndGate } from '../src/learning/rollouts.js';
import { generatePatchSuggestions } from '../src/learning/suggestions.js';
import { runContrastiveTraceAnalysis } from '../src/trace-intel/contrastive.js';

describe('Memory benchmark, PatchSuggestions & Gated Rollouts', () => {
  it('benchmarks 4 memory strategies across 5 LongMemEval slices and recommends observational-hybrid', () => {
    const report = runMemoryPrimitiveBenchmark();
    expect(report.datasetSize).toBe(25);
    expect(report.strategies).toHaveLength(4);
    expect(report.recommendedStrategy).toBe('observational-hybrid');

    const hybrid = report.strategies.find(s => s.strategy === 'observational-hybrid')!;
    const lastK = report.strategies.find(s => s.strategy === 'last-k')!;
    expect(hybrid.overallAccuracy).toBeGreaterThan(lastK.overallAccuracy);
    expect(hybrid.sliceBreakdown).toHaveLength(5);
  });

  it('generates prioritized suggestions and passes rollout promotion gate with identical repeat hash', async () => {
    const traces = buildCuratedBaselineTraces();
    const autoevals = await Promise.all(
      traces.map(t => evaluateTraceWithMastraScorers(t)),
    );
    const contrastive = runContrastiveTraceAnalysis(traces);
    const memoryBenchmark = runMemoryPrimitiveBenchmark();
    const suggestions = generatePatchSuggestions({
      autoevals,
      contrastive,
      memoryBenchmark,
    });

    expect(suggestions.length).toBeGreaterThanOrEqual(4);
    expect(suggestions[0]!.priority).toBe('P0');

    const rollout = await runRolloutAndGate(suggestions);
    expect(rollout.repeatabilityCheck.passed).toBe(true);
    expect(rollout.repeatabilityCheck.run1Hash).toBe(rollout.repeatabilityCheck.run2Hash);
    expect(rollout.gateVerdict).toBe('PROMOTE');
    expect(rollout.candidate.passedCases).toBe(rollout.candidate.totalCases);
    expect(rollout.deltas.passRateDelta).toBeGreaterThan(0);
  });
});
