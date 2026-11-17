#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCuratedBaselineTraces } from './benchmarks/datasets.js';
import { runMemoryPrimitiveBenchmark } from './benchmarks/memory-bench.js';
import { evaluateTraceWithMastraScorers } from './evals/scorers.js';
import { runRolloutAndGate } from './learning/rollouts.js';
import { generatePatchSuggestions } from './learning/suggestions.js';
import {
  renderUnifiedMarkdownReport,
  type UnifiedPipelineReport,
} from './reporting/markdown.js';
import { runContrastiveTraceAnalysis } from './trace-intel/contrastive.js';

export async function runUnifiedPipeline(): Promise<UnifiedPipelineReport> {
  const baselineTraces = buildCuratedBaselineTraces();
  const autoevals = await Promise.all(
    baselineTraces.map(t => evaluateTraceWithMastraScorers(t)),
  );
  const contrastive = runContrastiveTraceAnalysis(baselineTraces);
  const memoryBenchmark = runMemoryPrimitiveBenchmark();
  const suggestions = generatePatchSuggestions({
    autoevals,
    contrastive,
    memoryBenchmark,
  });
  const rollout = await runRolloutAndGate(suggestions);

  return {
    autoevals,
    contrastive,
    memoryBenchmark,
    suggestions,
    rollout,
  };
}

function parseOutDir(argv: string[]): string | null {
  const idx = argv.indexOf('--out');
  if (idx !== -1 && argv[idx + 1]) {
    return argv[idx + 1]!;
  }
  return null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'demo';
  const outDir = parseOutDir(args);

  if (command === 'bench-memory') {
    const report = runMemoryPrimitiveBenchmark();
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (command === 'rollout') {
    const pipeline = await runUnifiedPipeline();
    console.log(JSON.stringify(pipeline.rollout, null, 2));
    if (pipeline.rollout.gateVerdict !== 'PROMOTE') {
      process.exitCode = 1;
    }
    return;
  }

  if (command === 'autoeval') {
    const traces = buildCuratedBaselineTraces();
    const results = await Promise.all(
      traces.map(t => evaluateTraceWithMastraScorers(t)),
    );
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (command === 'demo') {
    const report = await runUnifiedPipeline();
    const md = renderUnifiedMarkdownReport(report);
    console.log(md);

    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'report.md'), md, 'utf8');
      writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
      console.log(`\nSaved artifacts to ${outDir}/report.md and ${outDir}/report.json`);
    }
    return;
  }

  console.error(
    `Unknown command "${command}". Supported: demo [--out <dir>], autoeval, bench-memory, rollout`,
  );
  process.exitCode = 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
}
