import {
  type FailureSignatureCode,
  type PatchSuggestion,
  type TraceAutoevalResult,
} from '../contracts/schemas.js';
import type { ContrastiveAnalysisReport } from '../trace-intel/contrastive.js';
import type { MemoryBenchmarkReport } from '../benchmarks/memory-bench.js';

interface SuggestionTemplate {
  kind: PatchSuggestion['kind'];
  priority: PatchSuggestion['priority'];
  targetPrimitive: PatchSuggestion['targetPrimitive'];
  title: string;
  rationale: string;
  patchSpec: Record<string, unknown>;
  estimatedPassRateGain: number;
}

const PATCH_TEMPLATES: Record<FailureSignatureCode, SuggestionTemplate> = {
  STALE_REF_DESYNC: {
    kind: 'PROMPT_INSTRUCTION_PATCH',
    priority: 'P0',
    targetPrimitive: 'agent.instructions',
    title: 'Enforce post-settle accessibility ref refresh after UI mutations',
    rationale:
      'Traces show agents reusing invalidated @eN refs after press/fill --settle mutations. Updating instructions and returning activeRefs in MCP tool results eliminates STALE_REF retries.',
    patchSpec: {
      instructionAppend:
        'After any press/fill with settle=true, discard prior @eN refs and select targets exclusively from the returned diffLines/activeRefs or take a fresh snapshot(interactiveOnly=true).',
      mcpToolReturnActiveRefs: true,
    },
    estimatedPassRateGain: 0.25,
  },
  TOOL_THRASH_LOOP: {
    kind: 'GUARDRAIL_PROCESSOR_PATCH',
    priority: 'P0',
    targetPrimitive: 'agent.processors',
    title: 'Add consecutive-identical tool-call circuit breaker processor',
    rationale:
      'Agents repeated identical failing tool invocations >=3 times without changing arguments or refreshing state.',
    patchSpec: {
      processor: 'ToolLoopCircuitBreaker',
      maxConsecutiveIdenticalCalls: 2,
      onTrip: 'inject_error_recovery_hint_or_abort',
    },
    estimatedPassRateGain: 0.2,
  },
  SPECIFICATION_GAMING: {
    kind: 'GUARDRAIL_PROCESSOR_PATCH',
    priority: 'P0',
    targetPrimitive: 'agent.processors',
    title: 'Require unpatched verification tool pass before emitting final completion',
    rationale:
      'Trajectory integrity checks flagged completion claims while required verification tools failed, were skipped, or test fixtures were modified.',
    patchSpec: {
      processor: 'VerificationGateProcessor',
      disallowTestFixtureWrites: true,
      requirePassingVerificationTool: true,
    },
    estimatedPassRateGain: 0.25,
  },
  MEMORY_STALE_OR_MISS: {
    kind: 'MEMORY_CONFIG_PATCH',
    priority: 'P1',
    targetPrimitive: 'mastra.memory',
    title: 'Upgrade memory from narrow last-k to observational-hybrid configuration',
    rationale:
      'Narrow last-k windows evicted prior relocation/state facts or returned superseded knowledge updates.',
    patchSpec: {
      strategy: 'observational-hybrid',
      lastMessages: 12,
      semanticTopK: 6,
      workingMemoryEnabled: true,
      observationalCompressionThresholdTokens: 4000,
    },
    estimatedPassRateGain: 0.3,
  },
  CASCADE_TOOL_FAILURE: {
    kind: 'TOOL_SCHEMA_OR_DESCRIPTION_PATCH',
    priority: 'P1',
    targetPrimitive: 'mcp.tool',
    title: 'Enrich MCP/tool error payloads with structured recovery hints',
    rationale:
      'Unrecovered tool failures lacked actionable recovery metadata (e.g., refreshed activeRefs or missing required params).',
    patchSpec: {
      includeRecoveryHintInToolError: true,
      validateInputsWithZodBeforeDispatch: true,
    },
    estimatedPassRateGain: 0.15,
  },
  BUDGET_AND_LATENCY_ANOMALY: {
    kind: 'PROMPT_INSTRUCTION_PATCH',
    priority: 'P2',
    targetPrimitive: 'agent.instructions',
    title: 'Cap multi-step exploratory tool calls and tighten prompt context budget',
    rationale:
      'Traces exceeded step, token, or TTFT thresholds due to redundant observations.',
    patchSpec: {
      maxSteps: 10,
      enablePromptCaching: true,
    },
    estimatedPassRateGain: 0.1,
  },
};

const PRIORITY_RANK: Record<PatchSuggestion['priority'], number> = {
  P0: 0,
  P1: 1,
  P2: 2,
};

/**
 * Converts diagnosed autoeval findings, contrastive peer divergences, and memory benchmark
 * recommendations into concrete, prioritized Mastra PatchSuggestions.
 */
export function generatePatchSuggestions(args: {
  autoevals: readonly TraceAutoevalResult[];
  contrastive?: ContrastiveAnalysisReport;
  memoryBenchmark?: MemoryBenchmarkReport;
}): PatchSuggestion[] {
  const bySignature = new Map<FailureSignatureCode, Set<string>>();

  for (const evalResult of args.autoevals) {
    for (const finding of evalResult.findings) {
      const set = bySignature.get(finding.code) ?? new Set<string>();
      set.add(evalResult.traceId);
      bySignature.set(finding.code, set);
    }
  }

  if (args.contrastive) {
    for (const div of args.contrastive.divergences) {
      if (div.primarySignature) {
        const set = bySignature.get(div.primarySignature) ?? new Set<string>();
        set.add(div.traceId);
        bySignature.set(div.primarySignature, set);
      }
    }
  }

  const suggestions: PatchSuggestion[] = [];
  let index = 1;

  for (const [code, traceSet] of bySignature.entries()) {
    const template = PATCH_TEMPLATES[code];
    const patchSpec =
      code === 'MEMORY_STALE_OR_MISS' && args.memoryBenchmark
        ? { ...args.memoryBenchmark.recommendedConfig }
        : { ...template.patchSpec };

    suggestions.push({
      id: `patch-${String(index).padStart(2, '0')}-${code.toLowerCase()}`,
      kind: template.kind,
      priority: template.priority,
      targetPrimitive: template.targetPrimitive,
      triggerSignature: code,
      title: template.title,
      rationale: template.rationale,
      patchSpec,
      supportingTraceIds: [...traceSet].sort(),
      estimatedPassRateGain: template.estimatedPassRateGain,
    });
    index++;
  }

  // If memory benchmark flagged a low baseline without trace findings, still surface tuning patch
  if (args.memoryBenchmark && !bySignature.has('MEMORY_STALE_OR_MISS')) {
    const template = PATCH_TEMPLATES.MEMORY_STALE_OR_MISS;
    suggestions.push({
      id: `patch-${String(index).padStart(2, '0')}-memory_benchmark_tuning`,
      kind: template.kind,
      priority: 'P1',
      targetPrimitive: 'mastra.memory',
      triggerSignature: 'MEMORY_STALE_OR_MISS',
      title: `Tune Mastra memory to ${args.memoryBenchmark.recommendedStrategy}`,
      rationale: args.memoryBenchmark.rationale,
      patchSpec: { ...args.memoryBenchmark.recommendedConfig },
      supportingTraceIds: ['longmemeval-mini-suite'],
      estimatedPassRateGain: 0.2,
    });
  }

  return suggestions.sort((a, b) => {
    const pDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (pDiff !== 0) return pDiff;
    return b.supportingTraceIds.length - a.supportingTraceIds.length;
  });
}
