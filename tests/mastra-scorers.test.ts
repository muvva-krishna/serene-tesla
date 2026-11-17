import { SpanType } from '@mastra/core/observability';
import { describe, expect, it } from 'vitest';
import { buildCuratedBaselineTraces } from '../src/benchmarks/datasets.js';
import { fromMastraSpans } from '../src/evals/mastra-adapter.js';
import {
  evaluateTraceWithMastraScorers,
  traceInvariantsScorer,
} from '../src/evals/scorers.js';

describe('@mastra/core MastraScorer & Observability adapter integration', () => {
  it('converts @mastra/core SpanType records and runs MastraScorer pipelines', async () => {
    const tree = fromMastraSpans(
      [
        {
          traceId: 'mastra-live-01',
          spanId: 'sp-root',
          parentSpanId: null,
          name: 'mastra-agent',
          spanType: SpanType.AGENT_RUN,
          startedAt: new Date('2026-11-17T10:00:00Z'),
          endedAt: new Date('2026-11-17T10:00:01Z'),
          input: { prompt: 'Check status' },
          output: 'Status healthy.',
          attributes: { totalTokens: 900 },
        },
        {
          traceId: 'mastra-live-01',
          spanId: 'sp-tool',
          parentSpanId: 'sp-root',
          name: 'health_check',
          spanType: SpanType.TOOL_CALL,
          startedAt: new Date('2026-11-17T10:00:00.100Z'),
          endedAt: new Date('2026-11-17T10:00:00.400Z'),
          input: {},
          output: { ok: true },
        },
      ],
      { traceId: 'mastra-live-01', taskId: 'health-check' },
    );

    const scorerRun = await traceInvariantsScorer.run({
      input: { taskId: 'health-check', expectedOutcome: null },
      output: { traceTree: tree },
    });
    expect(scorerRun.score).toBe(1);

    const autoeval = await evaluateTraceWithMastraScorers(tree);
    expect(autoeval.passed).toBe(true);
    expect(autoeval.overallScore).toBe(1);
    expect(autoeval.findings).toEqual([]);
  });

  it('scores curated baseline traces accurately across passing and failing cases', async () => {
    const traces = buildCuratedBaselineTraces();
    const results = await Promise.all(
      traces.map(t => evaluateTraceWithMastraScorers(t)),
    );
    const byId = new Map(results.map(r => [r.traceId, r]));

    expect(byId.get('trace-mcp-clean-01')!.passed).toBe(true);
    expect(byId.get('trace-mcp-stale-02')!.passed).toBe(false);
    expect(byId.get('trace-code-hack-02')!.passed).toBe(false);
    expect(byId.get('trace-mem-stale-02')!.passed).toBe(false);
  });
});
