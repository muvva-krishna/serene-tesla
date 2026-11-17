# Founder Pitch Brief — Mastra AI Engineer (Trace Intelligence, Autoevals & Rollouts)

## 30-Second Pitch

> Mastra already gives TypeScript developers agents, workflows, memory, and OpenTelemetry-native observability (`SpanRecord` + `createScorer`). The next leap is closing the **Agent Learning loop**: turning raw trace trees into automated failure diagnoses (**Trace Intelligence**), grading them reliably (**Autoevals**), generating targeted configuration/prompt/memory fixes (**Suggestions**), and gating promotions with repeatable experiments (**Rollouts**).
>
> I built **`agent-trace-coach`** in TypeScript directly on `@mastra/core/evals` and `@mastra/core/observability` to prototype that exact loop end-to-end—combining native `MastraScorer`s, TRACE-style contrastive peer analysis, `callstack/agent-device` MCP trajectory verification, and LongMemEval-style memory tuning.

---

## 3 Technical Insights Demonstrated in Code

1. **Why Trace Intelligence needs Contrastive Peer Analysis (not just `N=1` rules):**
   - In [`datasets.ts`](../src/benchmarks/datasets.ts) + [`contrastive.ts`](../src/trace-intel/contrastive.ts), `trace-silent-skip-02` completes with zero tool errors and scores `1.00` under `N=1` solo detectors—because it silently skipped `verify_output`.
   - Grouping traces by `taskId` with anonymized slot IDs (verified by `assertNoEvaluatorLeakage`) lifts anomaly recall from **75.0% (`N1_SOLO`) to 100.0% (`N4_MIXED`)** and pinpoints the exact divergence step (`Step 2: failing trace <halted early> vs. passing peer verify_output`).

2. **Grounded MCP Tool-Use & Accessibility-Tree Failure Modes (`callstack/agent-device`):**
   - Real UI/MCP agents fail in ways single-turn text evals miss—specifically `STALE_REF_DESYNC` after `--settle` renumbers `@e8 -> @e15`, triggering `TOOL_THRASH_LOOP` retries.
   - [`agent-device-adapter.ts`](../src/mcp/agent-device-adapter.ts) models that exact ref lifecycle, while [`suggestions.ts`](../src/learning/suggestions.ts) emits concrete `agent.instructions` + `agent.processors` + `mcp.tool` patches verified in [`rollouts.ts`](../src/learning/rollouts.ts) (`0/6 -> 6/6`, canonical SHA-256 repeatability verified).

3. **Benchmark-Driven Memory Tuning (`longmemeval`-style):**
   - [`memory-bench.ts`](../src/benchmarks/memory-bench.ts) benchmarks `last-k` (28.0%), `semantic-recall` (36.0%), `working-memory` (80.0%), and `observational-hybrid` (92.0%) across 5 capability slices (including knowledge updates, temporal ordering, and abstention), emitting a concrete `mastra.memory` config patch rather than guessing hyperparameters.

---

## Prior Work Supporting This Pitch

- **Multi-step agent trace evaluation:** [`muvva-krishna/terminal-wrench-peer-similarity`](https://github.com/muvva-krishna/terminal-wrench-peer-similarity) — contrastive reward-hack detection over long Terminal Wrench trajectories.
- **Custom benchmark & causal diagnosis:** [`muvva-krishna/BeliefDynamics_in_LLM`](https://github.com/muvva-krishna/BeliefDynamics_in_LLM) — 5-stage belief–action benchmark across 6 models with counterfactual interventions.
- **Rigorous evals & repeatable gates:** [`muvva-krishna/visual-safety-audit`](https://github.com/muvva-krishna/visual-safety-audit) & [`muvva-krishna/robo-audit-eval`](https://github.com/muvva-krishna/robo-audit-eval) — Wilson CIs, ablations, schema validation, and fail-closed repeatability gates.
- **TypeScript full-stack LLM auditing:** [`muvva-krishna/customs-refund-copilot`](https://github.com/muvva-krishna/customs-refund-copilot) — Next.js/TypeScript + structured tool-use + verification UI.
