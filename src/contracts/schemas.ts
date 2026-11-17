import { z } from 'zod';

/**
 * Mastra-compatible SpanType enum values mirroring
 * packages/core/src/observability/types.ts.
 */
export const mastraSpanTypeSchema = z.enum([
  'agent_run',
  'model_generation',
  'model_step',
  'model_chunk',
  'tool_call',
  'mcp_tool_call',
  'processor_run',
  'workflow_run',
  'workflow_step',
  'generic',
]);

export type MastraSpanType = z.infer<typeof mastraSpanTypeSchema>;

export const rawSpanRecordSchema = z.object({
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  parentSpanId: z.string().nullable().optional(),
  name: z.string().min(1),
  spanType: mastraSpanTypeSchema,
  isEvent: z.boolean().default(false),
  startedAt: z.union([z.string(), z.date()]),
  endedAt: z.union([z.string(), z.date()]).nullable().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.unknown().nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  experimentId: z.string().nullable().optional(),
  resourceId: z.string().nullable().optional(),
  threadId: z.string().nullable().optional(),
  timeToFirstChunkMs: z.number().nullable().optional(),
});

export type RawSpanRecord = z.input<typeof rawSpanRecordSchema>;

export interface NormalizedSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  spanType: MastraSpanType;
  isEvent: boolean;
  startedAtMs: number;
  endedAtMs: number | null;
  durationMs: number;
  input: unknown;
  output: unknown;
  error: unknown | null;
  attributes: Record<string, unknown>;
  metadata: Record<string, unknown>;
  tags: string[];
  experimentId: string | null;
  resourceId: string | null;
  threadId: string | null;
  timeToFirstChunkMs: number | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface TraceTreeNode {
  span: NormalizedSpan;
  children: TraceTreeNode[];
  depth: number;
}

export interface TraceTree {
  traceId: string;
  taskId: string;
  agentId: string;
  configId: string;
  expectedOutcome: string | null;
  groundTruthLabel: 'pass' | 'fail' | 'reward_hack' | null;
  rootSpans: TraceTreeNode[];
  orderedSpans: NormalizedSpan[];
  orphanSpanIds: string[];
  totalDurationMs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  stepCount: number;
  toolCallCount: number;
  errorCount: number;
  hasChildError: boolean;
  avgTimeToFirstChunkMs: number | null;
  finalOutput: string;
}

export const failureSignatureCodeSchema = z.enum([
  'TOOL_THRASH_LOOP',
  'STALE_REF_DESYNC',
  'SPECIFICATION_GAMING',
  'MEMORY_STALE_OR_MISS',
  'CASCADE_TOOL_FAILURE',
  'BUDGET_AND_LATENCY_ANOMALY',
]);

export type FailureSignatureCode = z.infer<typeof failureSignatureCodeSchema>;

export const failureFindingSchema = z.object({
  code: failureSignatureCodeSchema,
  severity: z.enum(['critical', 'warning', 'info']),
  title: z.string(),
  explanation: z.string(),
  spanIds: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  evidence: z.record(z.string(), z.unknown()),
});

export type FailureFinding = z.infer<typeof failureFindingSchema>;

export interface TraceAutoevalResult {
  traceId: string;
  taskId: string;
  configId: string;
  overallScore: number; // 0..1
  passed: boolean;
  scorerBreakdown: {
    traceInvariants: number;
    toolCallEfficiency: number;
    trajectoryIntegrity: number;
    groundingAndMemory: number;
  };
  findings: FailureFinding[];
  metrics: {
    stepCount: number;
    toolCallCount: number;
    totalTokens: number;
    durationMs: number;
    errorCount: number;
  };
}

export type PatchKind =
  | 'PROMPT_INSTRUCTION_PATCH'
  | 'TOOL_SCHEMA_OR_DESCRIPTION_PATCH'
  | 'MEMORY_CONFIG_PATCH'
  | 'GUARDRAIL_PROCESSOR_PATCH';

export interface PatchSuggestion {
  id: string;
  kind: PatchKind;
  priority: 'P0' | 'P1' | 'P2';
  targetPrimitive: 'agent.instructions' | 'mcp.tool' | 'mastra.memory' | 'agent.processors';
  triggerSignature: FailureSignatureCode;
  title: string;
  rationale: string;
  patchSpec: Record<string, unknown>;
  supportingTraceIds: string[];
  estimatedPassRateGain: number;
}

export type MemoryStrategy =
  | 'last-k'
  | 'semantic-recall'
  | 'working-memory'
  | 'observational-hybrid';

export type MemoryCapabilitySlice =
  | 'information-extraction'
  | 'multi-session-reasoning'
  | 'knowledge-update'
  | 'temporal-reasoning'
  | 'abstention';
