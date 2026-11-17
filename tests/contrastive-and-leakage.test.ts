import { describe, expect, it } from 'vitest';
import { buildCuratedBaselineTraces } from '../src/benchmarks/datasets.js';
import {
  assertNoEvaluatorLeakage,
  runContrastiveTraceAnalysis,
  sanitizeClusterForEvaluator,
} from '../src/trace-intel/contrastive.js';

describe('Contrastive peer trace analysis & leakage boundaries', () => {
  it('strips traceIds and ground-truth labels cleanly with zero leakage', () => {
    const traces = buildCuratedBaselineTraces();
    const { slots } = sanitizeClusterForEvaluator(traces);
    const audit = assertNoEvaluatorLeakage(slots, traces);

    expect(audit.passed).toBe(true);
    expect(audit.violations).toEqual([]);
    expect(slots[0]!.slotId).toBe('slot_0');
  });

  it('catches subtle skipped-verification omission in N4_MIXED that N1_SOLO misses', () => {
    const traces = buildCuratedBaselineTraces();
    const report = runContrastiveTraceAnalysis(traces);

    expect(report.leakageAudit.passed).toBe(true);
    const solo = report.conditionMetrics.find(m => m.mode === 'N1_SOLO')!;
    const mixedN4 = report.conditionMetrics.find(m => m.mode === 'N4_MIXED')!;

    expect(solo.anomalyRecall).toBeLessThan(1);
    expect(mixedN4.anomalyRecall).toBeGreaterThan(solo.anomalyRecall);
    expect(mixedN4.accuracy).toBe(1);
    expect(report.divergences.some(d => d.traceId === 'trace-silent-skip-02')).toBe(true);
  });
});
