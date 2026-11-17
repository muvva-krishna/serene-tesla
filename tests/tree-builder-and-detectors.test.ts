import { describe, expect, it } from 'vitest';
import { buildTraceTree } from '../src/trace-intel/tree-builder.js';
import {
  detectBudgetAndLatencyAnomaly,
  detectCascadeToolFailure,
  detectMemoryStaleOrMiss,
  detectSpecificationGaming,
  detectStaleRefDesync,
  detectToolThrashLoop,
  runAllTraceDetectors,
} from '../src/trace-intel/detectors.js';

const t = (offsetMs: number) =>
  new Date(Date.UTC(2026, 10, 17, 10, 0, 0) + offsetMs).toISOString();

describe('buildTraceTree & deterministic detectors', () => {
  it('reconstructs hierarchy, identifies orphan spans, and rolls up tokens/TTFT', () => {
    const tree = buildTraceTree(
      [
        {
          traceId: 'tr-1',
          spanId: 'root',
          parentSpanId: null,
          name: 'agent',
          spanType: 'agent_run',
          startedAt: t(0),
          endedAt: t(1000),
          output: 'done',
          attributes: { promptTokens: 400, completionTokens: 100 },
          timeToFirstChunkMs: 200,
        },
        {
          traceId: 'tr-1',
          spanId: 'child-1',
          parentSpanId: 'root',
          name: 'search',
          spanType: 'tool_call',
          startedAt: t(100),
          endedAt: t(400),
          attributes: { totalTokens: 250 },
        },
        {
          traceId: 'tr-1',
          spanId: 'orphan-1',
          parentSpanId: 'missing-parent',
          name: 'dangling',
          spanType: 'generic',
          startedAt: t(500),
          endedAt: t(600),
        },
      ],
      { traceId: 'tr-1', taskId: 'task-a' },
    );

    expect(tree.orphanSpanIds).toEqual(['orphan-1']);
    expect(tree.rootSpans).toHaveLength(2);
    expect(tree.totalTokens).toBe(750);
    expect(tree.totalDurationMs).toBe(1000);
    expect(tree.avgTimeToFirstChunkMs).toBe(200);
    expect(tree.toolCallCount).toBe(1);
  });

  it('detects alternating A-B-A-B tool thrash loops', () => {
    const tree = buildTraceTree(
      [
        {
          traceId: 'tr-thrash',
          spanId: 'r',
          parentSpanId: null,
          name: 'agent',
          spanType: 'agent_run',
          startedAt: t(0),
          endedAt: t(1000),
        },
        {
          traceId: 'tr-thrash',
          spanId: 's1',
          parentSpanId: 'r',
          name: 'tool_a',
          spanType: 'tool_call',
          startedAt: t(10),
          endedAt: t(20),
          input: { x: 1 },
        },
        {
          traceId: 'tr-thrash',
          spanId: 's2',
          parentSpanId: 'r',
          name: 'tool_b',
          spanType: 'tool_call',
          startedAt: t(30),
          endedAt: t(40),
          input: { y: 2 },
        },
        {
          traceId: 'tr-thrash',
          spanId: 's3',
          parentSpanId: 'r',
          name: 'tool_a',
          spanType: 'tool_call',
          startedAt: t(50),
          endedAt: t(60),
          input: { x: 1 },
        },
        {
          traceId: 'tr-thrash',
          spanId: 's4',
          parentSpanId: 'r',
          name: 'tool_b',
          spanType: 'tool_call',
          startedAt: t(70),
          endedAt: t(80),
          input: { y: 2 },
        },
      ],
      { traceId: 'tr-thrash' },
    );

    const findings = detectToolThrashLoop(tree);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe('TOOL_THRASH_LOOP');
  });

  it('detects stale ref desync, specification gaming, memory misses, error cascades, and budget breaches', () => {
    const tree = buildTraceTree(
      [
        {
          traceId: 'tr-multi',
          spanId: 'root',
          parentSpanId: null,
          name: 'agent',
          spanType: 'agent_run',
          startedAt: t(0),
          endedAt: t(40000),
          output: 'All tests pass and completed successfully!',
          metadata: { requiredVerificationTools: ['run_tests'] },
          attributes: { totalTokens: 35000 },
          timeToFirstChunkMs: 3200,
        },
        {
          traceId: 'tr-multi',
          spanId: 'snap',
          parentSpanId: 'root',
          name: 'agent_device_snapshot',
          spanType: 'mcp_tool_call',
          startedAt: t(10),
          endedAt: t(20),
          output: { activeRefs: ['@e1', '@e2'] },
        },
        {
          traceId: 'tr-multi',
          spanId: 'fill-stale',
          parentSpanId: 'root',
          name: 'agent_device_fill',
          spanType: 'mcp_tool_call',
          startedAt: t(30),
          endedAt: t(40),
          input: { ref: '@e99', value: 'x' },
          error: { message: 'STALE_REF' },
        },
        {
          traceId: 'tr-multi',
          spanId: 'mem',
          parentSpanId: 'root',
          name: 'memory_recall',
          spanType: 'tool_call',
          startedAt: t(50),
          endedAt: t(60),
          attributes: { staleFactUsed: true, memoryStrategy: 'last-k' },
        },
      ],
      { traceId: 'tr-multi' },
    );

    expect(detectStaleRefDesync(tree)).toHaveLength(1);
    expect(detectSpecificationGaming(tree)).toHaveLength(1);
    expect(detectMemoryStaleOrMiss(tree)).toHaveLength(1);
    expect(detectCascadeToolFailure(tree)).toHaveLength(1);
    expect(detectBudgetAndLatencyAnomaly(tree)).toHaveLength(1);

    const allCodes = runAllTraceDetectors(tree).map(f => f.code);
    expect(allCodes).toContain('STALE_REF_DESYNC');
    expect(allCodes).toContain('SPECIFICATION_GAMING');
    expect(allCodes).toContain('MEMORY_STALE_OR_MISS');
    expect(allCodes).toContain('CASCADE_TOOL_FAILURE');
    expect(allCodes).toContain('BUDGET_AND_LATENCY_ANOMALY');
  });
});
