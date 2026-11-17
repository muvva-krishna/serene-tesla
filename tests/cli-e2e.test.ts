import { describe, expect, it } from 'vitest';
import { runUnifiedPipeline } from '../src/cli.js';
import { renderUnifiedHtmlReport } from '../src/reporting/html.js';
import { renderUnifiedMarkdownReport } from '../src/reporting/markdown.js';

describe('End-to-end unified pipeline & Markdown/HTML reports', () => {
  it('executes complete trace-intel -> autoevals -> suggestions -> rollout -> memory benchmark flow', async () => {
    const report = await runUnifiedPipeline();
    const markdown = renderUnifiedMarkdownReport(report);
    const html = renderUnifiedHtmlReport(report);

    expect(markdown).toContain('## 1. Autoeval Summary');
    expect(markdown).toContain('## 2. Contrastive Peer Trace Analysis');
    expect(markdown).toContain('## 3. Memory Primitive Benchmark');
    expect(markdown).toContain('## 4. Prioritized Patch Suggestions');
    expect(markdown).toContain('## 5. Rollout Comparison & Fail-Closed Promotion Gate');
    expect(markdown).toContain('**Gate Verdict:** **PROMOTE**');

    expect(html).toContain('<title>Agent Trace Coach — Evaluation Dashboard</title>');
    expect(html).toContain('observational-hybrid');
    expect(html).toContain('PROMOTE');
  });
});
