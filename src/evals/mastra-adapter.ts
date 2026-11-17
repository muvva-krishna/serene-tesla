import { SpanType } from '@mastra/core/observability';
import type { RawSpanRecord, TraceTree } from '../contracts/schemas.js';
import { buildTraceTree, type TraceBuildMetadata } from '../trace-intel/tree-builder.js';

const SUPPORTED_SPAN_TYPES = new Set<string>([
  SpanType.AGENT_RUN,
  SpanType.MODEL_GENERATION,
  SpanType.MODEL_STEP,
  SpanType.MODEL_CHUNK,
  SpanType.TOOL_CALL,
  SpanType.MCP_TOOL_CALL,
  SpanType.PROCESSOR_RUN,
  SpanType.WORKFLOW_RUN,
  SpanType.WORKFLOW_STEP,
  SpanType.GENERIC,
]);

export interface MastraSpanLike {
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
  name: string;
  spanType: string;
  isEvent?: boolean;
  startedAt: string | Date;
  endedAt?: string | Date | null;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  attributes?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  tags?: string[] | null;
  experimentId?: string | null;
  resourceId?: string | null;
  threadId?: string | null;
  timeToFirstChunkMs?: number | null;
}

function previewText(value: unknown, maxLen = 100): string | null {
  if (value === undefined || value === null) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

/**
 * Converts @mastra/core Observability / Storage span records into validated
 * TraceCoach spans, normalizing unrecognized SpanTypes to `generic`.
 */
export function fromMastraSpans(
  spans: readonly MastraSpanLike[],
  meta: TraceBuildMetadata,
): TraceTree {
  const normalized: RawSpanRecord[] = spans.map(s => {
    const mappedType = SUPPORTED_SPAN_TYPES.has(s.spanType)
      ? (s.spanType as RawSpanRecord['spanType'])
      : 'generic';

    const inputPreview = previewText(s.input);

    return {
      traceId: s.traceId,
      spanId: s.spanId,
      parentSpanId: s.parentSpanId ?? null,
      name: s.name,
      spanType: mappedType,
      isEvent: s.isEvent ?? false,
      startedAt: s.startedAt,
      endedAt: s.endedAt ?? null,
      input: s.input,
      output: s.output,
      error: s.error ?? null,
      attributes: s.attributes ?? null,
      metadata: {
        ...(s.metadata ?? {}),
        ...(inputPreview ? { inputPreview } : {}),
      },
      tags: s.tags ?? null,
      experimentId: s.experimentId ?? null,
      resourceId: s.resourceId ?? null,
      threadId: s.threadId ?? null,
      timeToFirstChunkMs: s.timeToFirstChunkMs ?? null,
    };
  });

  return buildTraceTree(normalized, meta);
}
