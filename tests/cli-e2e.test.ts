import { describe, expect, it } from 'vitest';
import { runUnifiedPipeline } from '../src/cli.js';
import { renderUnifiedMarkdownReport } from '../src/reporting/markdown.js';

describe('End-to-end unified pipeline & Markdown report', () => {
  it('executes complete trace-intel -> autoevals -> suggestions -> rollout -> memory benchmark flow', async () => {
    const report = await runUnifiedPipeline();
    const markdown = renderUnifiedMarkdownReport(report);

    expect(markdown).toContain('## 1. Autoeval Summary');
    expect(markdown).toContain('## 2. Contrastive Peer Trace Analysis');
    expect(markdown).toContain('## 3. Memory Primitive Benchmark');
    expect(markdown).toContain('## 4. Prioritized Patch Suggestions');
    expect(markdown).toContain('## 5. Rollout Comparison & Fail-Closed Promotion Gate');
    expect(markdown).toContain('**Gate Verdict:** **PROMOTE**');
  });
});
