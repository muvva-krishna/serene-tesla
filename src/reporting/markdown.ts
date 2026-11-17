import type { PatchSuggestion, TraceAutoevalResult } from '../contracts/schemas.js';
import type { MemoryBenchmarkReport } from '../benchmarks/memory-bench.js';
import type { RolloutComparisonReport } from '../learning/rollouts.js';
import type { ContrastiveAnalysisReport } from '../trace-intel/contrastive.js';

export interface UnifiedPipelineReport {
  autoevals: TraceAutoevalResult[];
  contrastive: ContrastiveAnalysisReport;
  memoryBenchmark: MemoryBenchmarkReport;
  suggestions: PatchSuggestion[];
  rollout: RolloutComparisonReport;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

export function renderUnifiedMarkdownReport(report: UnifiedPipelineReport): string {
  const lines: string[] = [];

  lines.push('# Agent Trace Coach — Agent Learning & Evaluation Report');
  lines.push('');
  lines.push(
    'Unified Trace Intelligence, `@mastra/core` Scorer Autoevals, Contrastive Peer Diagnostics, Memory Primitive Benchmarking, Patch Suggestions, and Gated Rollouts.',
  );
  lines.push('');

  lines.push('## 1. Autoeval Summary (`@mastra/core` MastraScorers)');
  lines.push('');
  lines.push('| Trace ID | Task | Score | Passed | Findings | Tokens | Duration (ms) |');
  lines.push('| --- | --- | ---: | :---: | --- | ---: | ---: |');
  for (const r of report.autoevals) {
    const codes =
      r.findings.length > 0 ? r.findings.map(f => `\`${f.code}\``).join(', ') : 'None';
    lines.push(
      `| \`${r.traceId}\` | \`${r.taskId}\` | ${r.overallScore.toFixed(2)} | ${r.passed ? 'PASS' : 'FAIL'} | ${codes} | ${r.metrics.totalTokens} | ${r.metrics.durationMs} |`,
    );
  }
  lines.push('');

  lines.push('## 2. Contrastive Peer Trace Analysis (TRACE-Inspired)');
  lines.push('');
  lines.push(
    `- **Evaluator Leakage Audit:** ${report.contrastive.leakageAudit.passed ? 'PASSED (0 violations)' : `FAILED (${report.contrastive.leakageAudit.violations.join(', ')})`}`,
  );
  lines.push('');
  lines.push('| Condition | n | Accuracy | 95% Wilson CI | Precision | Anomaly Recall | Benign Specificity |');
  lines.push('| --- | ---: | ---: | --- | ---: | ---: | ---: |');
  for (const c of report.contrastive.conditionMetrics) {
    lines.push(
      `| \`${c.mode}\` | ${c.scoredCount} | ${pct(c.accuracy)} | [${pct(c.accuracyCi95.lower)}, ${pct(c.accuracyCi95.upper)}] | ${pct(c.precision)} | ${pct(c.anomalyRecall)} | ${pct(c.benignSpecificity)} |`,
    );
  }
  lines.push('');

  if (report.contrastive.divergences.length > 0) {
    lines.push('### Peer Divergence Pinpoints');
    lines.push('');
    for (const d of report.contrastive.divergences) {
      lines.push(`- \`${d.traceId}\` (${d.taskId}): ${d.summary}`);
    }
    lines.push('');
  }

  lines.push('## 3. Memory Primitive Benchmark (LongMemEval-Style)');
  lines.push('');
  lines.push(`- **Recommended Strategy:** \`${report.memoryBenchmark.recommendedStrategy}\``);
  lines.push(`- **Rationale:** ${report.memoryBenchmark.rationale}`);
  lines.push('');
  lines.push('| Strategy | Accuracy | 95% Wilson CI | Avg Prompt Tokens | Avg Latency (ms) |');
  lines.push('| --- | ---: | --- | ---: | ---: |');
  for (const m of report.memoryBenchmark.strategies) {
    lines.push(
      `| \`${m.strategy}\` | ${pct(m.overallAccuracy)} | [${pct(m.accuracyCi95.lower)}, ${pct(m.accuracyCi95.upper)}] | ${m.avgPromptTokens} | ${m.avgLatencyMs} |`,
    );
  }
  lines.push('');

  lines.push('## 4. Prioritized Patch Suggestions');
  lines.push('');
  for (const s of report.suggestions) {
    lines.push(
      `- **[${s.priority}] \`${s.id}\`** -> \`${s.targetPrimitive}\` (${s.title}) — supported by ${s.supportingTraceIds.join(', ')}`,
    );
  }
  lines.push('');

  lines.push('## 5. Rollout Comparison & Fail-Closed Promotion Gate');
  lines.push('');
  lines.push(`- **Gate Verdict:** **${report.rollout.gateVerdict}**`);
  lines.push(
    `- **Repeatability Check (Canonical SHA-256):** ${report.rollout.repeatabilityCheck.passed ? 'IDENTICAL' : 'MISMATCH'} (\`${report.rollout.repeatabilityCheck.run1Hash.slice(0, 12)}\`)`,
  );
  lines.push(
    `- **Baseline:** ${report.rollout.baseline.passedCases}/${report.rollout.baseline.totalCases} (${pct(report.rollout.baseline.passRate)}, mean score ${report.rollout.baseline.meanAutoevalScore.toFixed(2)}, avg tokens ${report.rollout.baseline.meanTokens})`,
  );
  lines.push(
    `- **Candidate:** ${report.rollout.candidate.passedCases}/${report.rollout.candidate.totalCases} (${pct(report.rollout.candidate.passRate)}, mean score ${report.rollout.candidate.meanAutoevalScore.toFixed(2)}, avg tokens ${report.rollout.candidate.meanTokens})`,
  );
  for (const reason of report.rollout.gateReasons) {
    lines.push(`- ${reason}`);
  }
  lines.push('');

  return lines.join('\n');
}
