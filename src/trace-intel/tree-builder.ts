import {
  rawSpanRecordSchema,
  type NormalizedSpan,
  type RawSpanRecord,
  type TraceTree,
  type TraceTreeNode,
} from '../contracts/schemas.js';

export interface TraceBuildMetadata {
  traceId: string;
  taskId?: string;
  agentId?: string;
  configId?: string;
  expectedOutcome?: string | null;
  groundTruthLabel?: 'pass' | 'fail' | 'reward_hack' | null;
}

function toTimestampMs(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function readNumericAttr(attrs: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const val = attrs[key];
    if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
      return val;
    }
  }
  const usage = attrs.usage;
  if (usage && typeof usage === 'object') {
    for (const key of keys) {
      const val = (usage as Record<string, unknown>)[key];
      if (typeof val === 'number' && Number.isFinite(val) && val >= 0) {
        return val;
      }
    }
  }
  return 0;
}

function normalizeSpan(raw: RawSpanRecord): NormalizedSpan {
  const startedAtMs = toTimestampMs(raw.startedAt) ?? 0;
  const endedAtMs = toTimestampMs(raw.endedAt);
  const durationMs =
    endedAtMs !== null ? Math.max(0, endedAtMs - startedAtMs) : 0;
  const attributes = raw.attributes ?? {};
  const promptTokens = readNumericAttr(attributes, [
    'promptTokens',
    'inputTokens',
    'gen_ai.usage.input_tokens',
  ]);
  const completionTokens = readNumericAttr(attributes, [
    'completionTokens',
    'outputTokens',
    'gen_ai.usage.output_tokens',
  ]);
  const explicitTotal = readNumericAttr(attributes, [
    'totalTokens',
    'gen_ai.usage.total_tokens',
  ]);
  const totalTokens = explicitTotal > 0 ? explicitTotal : promptTokens + completionTokens;

  return {
    traceId: raw.traceId,
    spanId: raw.spanId,
    parentSpanId: raw.parentSpanId ?? null,
    name: raw.name,
    spanType: raw.spanType,
    isEvent: raw.isEvent ?? false,
    startedAtMs,
    endedAtMs,
    durationMs,
    input: raw.input ?? null,
    output: raw.output ?? null,
    error: raw.error ?? null,
    attributes,
    metadata: raw.metadata ?? {},
    tags: raw.tags ?? [],
    experimentId: raw.experimentId ?? null,
    resourceId: raw.resourceId ?? null,
    threadId: raw.threadId ?? null,
    timeToFirstChunkMs: raw.timeToFirstChunkMs ?? null,
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

function stringifyOutput(output: unknown): string {
  if (output === null || output === undefined) return '';
  if (typeof output === 'string') return output;
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function assignDepth(node: TraceTreeNode, depth: number): void {
  node.depth = depth;
  node.children.sort((a, b) =>
    a.span.startedAtMs !== b.span.startedAtMs
      ? a.span.startedAtMs - b.span.startedAtMs
      : a.span.spanId.localeCompare(b.span.spanId),
  );
  for (const child of node.children) {
    assignDepth(child, depth + 1);
  }
}

/**
 * Reconstructs a hierarchical TraceTree from flat Mastra-compatible SpanRecords.
 * Handles orphan spans (missing parentSpanId target), clock skew, and usage/latency rollups.
 */
export function buildTraceTree(
  rawSpans: readonly RawSpanRecord[],
  meta: TraceBuildMetadata,
): TraceTree {
  const parsed = rawSpans.map(s => rawSpanRecordSchema.parse(s));
  const spans = parsed
    .filter(s => s.traceId === meta.traceId)
    .map(normalizeSpan)
    .sort((a, b) =>
      a.startedAtMs !== b.startedAtMs
        ? a.startedAtMs - b.startedAtMs
        : a.spanId.localeCompare(b.spanId),
    );

  const nodeMap = new Map<string, TraceTreeNode>();
  for (const span of spans) {
    nodeMap.set(span.spanId, { span, children: [], depth: 0 });
  }

  const rootSpans: TraceTreeNode[] = [];
  const orphanSpanIds: string[] = [];

  for (const span of spans) {
    const node = nodeMap.get(span.spanId)!;
    if (span.parentSpanId === null) {
      rootSpans.push(node);
    } else {
      const parent = nodeMap.get(span.parentSpanId);
      if (parent && parent.span.spanId !== span.spanId) {
        parent.children.push(node);
      } else {
        orphanSpanIds.push(span.spanId);
        rootSpans.push(node);
      }
    }
  }

  rootSpans.sort((a, b) =>
    a.span.startedAtMs !== b.span.startedAtMs
      ? a.span.startedAtMs - b.span.startedAtMs
      : a.span.spanId.localeCompare(b.span.spanId),
  );
  for (const root of rootSpans) {
    assignDepth(root, 0);
  }

  const minStart = spans.length > 0 ? Math.min(...spans.map(s => s.startedAtMs)) : 0;
  const maxEnd =
    spans.length > 0
      ? Math.max(...spans.map(s => s.endedAtMs ?? s.startedAtMs + s.durationMs))
      : 0;

  const totalDurationMs = Math.max(0, maxEnd - minStart);
  const totalPromptTokens = spans.reduce((acc, s) => acc + s.promptTokens, 0);
  const totalCompletionTokens = spans.reduce((acc, s) => acc + s.completionTokens, 0);
  const totalTokens = spans.reduce((acc, s) => acc + s.totalTokens, 0);

  const toolCalls = spans.filter(
    s => s.spanType === 'tool_call' || s.spanType === 'mcp_tool_call',
  );
  const modelSteps = spans.filter(
    s => s.spanType === 'model_step' || s.spanType === 'model_generation',
  );
  const stepCount = Math.max(modelSteps.length, toolCalls.length);
  const errorSpans = spans.filter(s => s.error !== null);
  const ttfts = spans
    .map(s => s.timeToFirstChunkMs)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  const rootAgentSpan =
    rootSpans.find(n => n.span.spanType === 'agent_run')?.span ??
    rootSpans[0]?.span ??
    spans[spans.length - 1];

  const firstMeta = spans[0]?.metadata ?? {};

  return {
    traceId: meta.traceId,
    taskId:
      meta.taskId ??
      (typeof firstMeta.taskId === 'string' ? firstMeta.taskId : 'unknown-task'),
    agentId:
      meta.agentId ??
      (typeof firstMeta.agentId === 'string' ? firstMeta.agentId : 'unknown-agent'),
    configId:
      meta.configId ??
      (typeof firstMeta.configId === 'string' ? firstMeta.configId : 'baseline'),
    expectedOutcome: meta.expectedOutcome ?? null,
    groundTruthLabel: meta.groundTruthLabel ?? null,
    rootSpans,
    orderedSpans: spans,
    orphanSpanIds,
    totalDurationMs,
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens,
    stepCount,
    toolCallCount: toolCalls.length,
    errorCount: errorSpans.length,
    hasChildError: errorSpans.length > 0,
    avgTimeToFirstChunkMs:
      ttfts.length > 0
        ? Number((ttfts.reduce((a, b) => a + b, 0) / ttfts.length).toFixed(2))
        : null,
    finalOutput: stringifyOutput(rootAgentSpan?.output),
  };
}
