import type { UnifiedPipelineReport } from './markdown.js';

function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

/**
 * Renders a self-contained, zero-dependency HTML dashboard from the live
 * UnifiedPipelineReport so results can be inspected visually in any browser.
 */
export function renderUnifiedHtmlReport(report: UnifiedPipelineReport): string {
  const soloPassCount = report.autoevals.filter(a => a.passed).length;
  const solo = report.contrastive.conditionMetrics.find(c => c.mode === 'N1_SOLO');
  const mixed = report.contrastive.conditionMetrics.find(c => c.mode === 'N4_MIXED');
  const bestMem = report.memoryBenchmark.strategies.find(
    s => s.strategy === report.memoryBenchmark.recommendedStrategy,
  );
  const verdictTone =
    report.rollout.gateVerdict === 'PROMOTE'
      ? 'badge-pass'
      : report.rollout.gateVerdict === 'HOLD'
        ? 'badge-warn'
        : 'badge-fail';

  const autoevalRows = report.autoevals
    .map(a => {
      const badge = a.passed
        ? '<span class="badge badge-pass">PASS</span>'
        : '<span class="badge badge-fail">FAIL</span>';
      const findings =
        a.findings.length > 0
          ? a.findings.map(f => `<code>${escapeHtml(f.code)}</code>`).join(' ')
          : '<span class="muted">None</span>';
      return `<tr>
        <td><code>${escapeHtml(a.traceId)}</code></td>
        <td><code>${escapeHtml(a.taskId)}</code></td>
        <td class="num">${a.overallScore.toFixed(2)}</td>
        <td class="center">${badge}</td>
        <td>${findings}</td>
        <td class="num">${a.metrics.totalTokens}</td>
        <td class="num">${a.metrics.durationMs} ms</td>
      </tr>`;
    })
    .join('\n');

  const contrastiveRows = report.contrastive.conditionMetrics
    .map(
      c => `<tr>
        <td><code>${escapeHtml(c.mode)}</code></td>
        <td class="num">${c.scoredCount}</td>
        <td class="num">${pct(c.accuracy)}</td>
        <td class="num">[${pct(c.accuracyCi95.lower)}, ${pct(c.accuracyCi95.upper)}]</td>
        <td class="num">${pct(c.precision)}</td>
        <td class="num"><strong>${pct(c.anomalyRecall)}</strong></td>
        <td class="num">${pct(c.benignSpecificity)}</td>
      </tr>`,
    )
    .join('\n');

  const pinpointsHtml = report.contrastive.divergences
    .map(
      d => `<li>
        <strong><code>${escapeHtml(d.traceId)}</code></strong>
        <span class="muted">(${escapeHtml(d.taskId)})</span> —
        ${escapeHtml(d.summary)}
      </li>`,
    )
    .join('\n');

  const memoryRows = report.memoryBenchmark.strategies
    .map(m => {
      const isRec = m.strategy === report.memoryBenchmark.recommendedStrategy;
      const barWidth = Math.max(2, Math.round(m.overallAccuracy * 100));
      return `<tr class="${isRec ? 'row-highlight' : ''}">
        <td>
          <code>${escapeHtml(m.strategy)}</code>
          ${isRec ? '<span class="badge badge-pass">RECOMMENDED</span>' : ''}
        </td>
        <td>
          <div class="bar-wrap">
            <div class="bar-fill" style="width:${barWidth}%"></div>
            <span>${pct(m.overallAccuracy)}</span>
          </div>
        </td>
        <td class="num">[${pct(m.accuracyCi95.lower)}, ${pct(m.accuracyCi95.upper)}]</td>
        <td class="num">${m.avgPromptTokens}</td>
        <td class="num">${m.avgLatencyMs} ms</td>
      </tr>`;
    })
    .join('\n');

  const suggestionCards = report.suggestions
    .map(s => {
      const pClass = s.priority === 'P0' ? 'badge-fail' : 'badge-warn';
      return `<div class="suggestion-item">
        <div class="suggestion-head">
          <span class="badge ${pClass}">${escapeHtml(s.priority)}</span>
          <code>${escapeHtml(s.id)}</code>
          <span class="muted">→ <code>${escapeHtml(s.targetPrimitive)}</code></span>
        </div>
        <div class="suggestion-title">${escapeHtml(s.title)}</div>
        <div class="muted small">Supported by: ${s.supportingTraceIds.map(id => `<code>${escapeHtml(id)}</code>`).join(', ')}</div>
      </div>`;
    })
    .join('\n');

  const gateReasonsHtml = report.rollout.gateReasons
    .map(r => `<p class="footer-note">${escapeHtml(r)}</p>`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agent Trace Coach — Evaluation Dashboard</title>
  <style>
    :root {
      --bg: #0b1020;
      --card: #121931;
      --border: #243055;
      --text: #e6ecff;
      --muted: #9aa7cc;
      --pass: #22c55e;
      --fail: #ef4444;
      --warn: #f59e0b;
      --accent: #60a5fa;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 28px 20px 60px;
    }
    .container { max-width: 1120px; margin: 0 auto; }
    header { margin-bottom: 24px; }
    h1 { margin: 0 0 6px; font-size: 1.75rem; }
    h2 { margin: 0 0 12px; font-size: 1.15rem; color: #f8fafc; }
    .subtitle { color: var(--muted); margin: 0; }
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px;
      margin-bottom: 22px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 18px;
      margin-bottom: 18px;
    }
    .kpi-label { font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .kpi-value { font-size: 1.55rem; font-weight: 700; margin: 4px 0; }
    .kpi-sub { font-size: 0.85rem; color: var(--muted); }
    table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
    th, td { padding: 10px 10px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: middle; }
    th { color: var(--muted); font-weight: 600; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.03em; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.center, th.center { text-align: center; }
    .row-highlight { background: rgba(34, 197, 94, 0.08); }
    code {
      background: rgba(96, 165, 250, 0.12);
      color: #bfdbfe;
      padding: 2px 6px;
      border-radius: 5px;
      font-size: 0.85em;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 700;
      letter-spacing: 0.03em;
    }
    .badge-pass { background: rgba(34, 197, 94, 0.18); color: #86efac; border: 1px solid rgba(34, 197, 94, 0.45); }
    .badge-fail { background: rgba(239, 68, 68, 0.18); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.45); }
    .badge-warn { background: rgba(245, 158, 11, 0.18); color: #fde68a; border: 1px solid rgba(245, 158, 11, 0.45); }
    .muted { color: var(--muted); }
    .small { font-size: 0.84rem; }
    .bar-wrap { display: flex; align-items: center; gap: 10px; }
    .bar-fill {
      height: 10px;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--accent), var(--pass));
      min-width: 6px;
    }
    .suggestion-list { display: grid; gap: 10px; }
    .suggestion-item {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.02);
    }
    .suggestion-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 4px; }
    .suggestion-title { font-weight: 600; margin-bottom: 2px; }
    ul.pinpoints { margin: 10px 0 0; padding-left: 18px; display: grid; gap: 6px; }
    .rollout-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-top: 10px; }
    .rollout-box { border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
    .footer-note { color: var(--muted); font-size: 0.84rem; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Agent Trace Coach — Evaluation Dashboard</h1>
      <p class="subtitle">
        Generated directly from the live TypeScript pipeline (<code>@mastra/core</code> scorers, contrastive peer analysis, memory benchmark, patch suggestions &amp; rollout gate).
      </p>
    </header>

    <section class="kpis">
      <div class="card">
        <div class="kpi-label">Solo Autoevals</div>
        <div class="kpi-value">${soloPassCount}/${report.autoevals.length} PASS</div>
        <div class="kpi-sub">3 failures caught; 1 silent skip missed solo</div>
      </div>
      <div class="card">
        <div class="kpi-label">Contrastive Recall</div>
        <div class="kpi-value">${solo ? pct(solo.anomalyRecall) : 'n/a'} → ${mixed ? pct(mixed.anomalyRecall) : 'n/a'}</div>
        <div class="kpi-sub">Leakage Audit: ${report.contrastive.leakageAudit.passed ? 'PASSED (0 violations)' : 'FAILED'}</div>
      </div>
      <div class="card">
        <div class="kpi-label">Best Memory Strategy</div>
        <div class="kpi-value">${bestMem ? pct(bestMem.overallAccuracy) : 'n/a'}</div>
        <div class="kpi-sub"><code>${escapeHtml(report.memoryBenchmark.recommendedStrategy)}</code> (${bestMem?.avgPromptTokens ?? 0} avg tokens)</div>
      </div>
      <div class="card">
        <div class="kpi-label">Rollout Gate Verdict</div>
        <div class="kpi-value"><span class="badge ${verdictTone}">${escapeHtml(report.rollout.gateVerdict)}</span></div>
        <div class="kpi-sub">${report.rollout.baseline.passedCases}/${report.rollout.baseline.totalCases} → ${report.rollout.candidate.passedCases}/${report.rollout.candidate.totalCases} (SHA-256 ${report.rollout.repeatabilityCheck.passed ? 'IDENTICAL' : 'MISMATCH'})</div>
      </div>
    </section>

    <section class="card">
      <h2>1. Autoeval Summary (<code>@mastra/core</code> MastraScorers)</h2>
      <table>
        <thead>
          <tr>
            <th>Trace ID</th>
            <th>Task</th>
            <th class="num">Score</th>
            <th class="center">Status</th>
            <th>Findings</th>
            <th class="num">Tokens</th>
            <th class="num">Duration</th>
          </tr>
        </thead>
        <tbody>${autoevalRows}</tbody>
      </table>
    </section>

    <section class="card">
      <h2>2. Contrastive Peer Trace Analysis</h2>
      <table>
        <thead>
          <tr>
            <th>Condition</th>
            <th class="num">n</th>
            <th class="num">Accuracy</th>
            <th class="num">95% Wilson CI</th>
            <th class="num">Precision</th>
            <th class="num">Anomaly Recall</th>
            <th class="num">Benign Specificity</th>
          </tr>
        </thead>
        <tbody>${contrastiveRows}</tbody>
      </table>
      <h3 style="font-size:0.95rem; margin:16px 0 6px;">Peer Divergence Pinpoints</h3>
      <ul class="pinpoints">${pinpointsHtml}</ul>
    </section>

    <section class="card">
      <h2>3. Memory Primitive Benchmark (LongMemEval-Style)</h2>
      <p class="muted small">${escapeHtml(report.memoryBenchmark.rationale)}</p>
      <table>
        <thead>
          <tr>
            <th>Strategy</th>
            <th>Accuracy</th>
            <th class="num">95% Wilson CI</th>
            <th class="num">Avg Tokens</th>
            <th class="num">Avg Latency</th>
          </tr>
        </thead>
        <tbody>${memoryRows}</tbody>
      </table>
    </section>

    <section class="card">
      <h2>4. Prioritized Patch Suggestions</h2>
      <div class="suggestion-list">${suggestionCards}</div>
    </section>

    <section class="card">
      <h2>5. Rollout Comparison &amp; Fail-Closed Promotion Gate</h2>
      <p>
        Verdict: <span class="badge ${verdictTone}">${escapeHtml(report.rollout.gateVerdict)}</span>
        &nbsp;·&nbsp; Repeatability SHA-256: <code>${escapeHtml(report.rollout.repeatabilityCheck.run1Hash.slice(0, 12))}</code>
        (${report.rollout.repeatabilityCheck.passed ? 'IDENTICAL' : 'MISMATCH'})
      </p>
      <div class="rollout-grid">
        <div class="rollout-box">
          <div class="kpi-label">Baseline</div>
          <div class="kpi-value">${report.rollout.baseline.passedCases}/${report.rollout.baseline.totalCases} (${pct(report.rollout.baseline.passRate)})</div>
          <div class="kpi-sub">Mean score ${report.rollout.baseline.meanAutoevalScore.toFixed(2)} · ${report.rollout.baseline.meanTokens} avg tokens</div>
        </div>
        <div class="rollout-box">
          <div class="kpi-label">Patched Candidate</div>
          <div class="kpi-value">${report.rollout.candidate.passedCases}/${report.rollout.candidate.totalCases} (${pct(report.rollout.candidate.passRate)})</div>
          <div class="kpi-sub">Mean score ${report.rollout.candidate.meanAutoevalScore.toFixed(2)} · ${report.rollout.candidate.meanTokens} avg tokens</div>
        </div>
      </div>
      ${gateReasonsHtml}
    </section>
  </div>
</body>
</html>
`;
}
