import type { Message as StorageMessage } from '@extension/storage';
import { ACTOR_PROFILES } from '../types/message';
import { memo, useEffect, useRef } from 'react';
import { FiActivity, FiAlertTriangle, FiCheck, FiCompass, FiCpu, FiLoader } from 'react-icons/fi';
import { Message as PromptMessage, MessageContent } from './prompt-kit/message';
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtItem,
  ChainOfThoughtStep,
  ChainOfThoughtTrigger,
} from './prompt-kit/chain-of-thought';
import type { ToolPart } from './prompt-kit/tool';

interface MessageListProps {
  messages: StorageMessage[];
}

export default memo(function MessageList({ messages }: MessageListProps) {
  const items = buildDisplayItems(messages);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-5">
      {items.map((item, index) => {
        if (item.type === 'trace') {
          return (
            <RunTrace
              key={`trace-${item.steps[0]?.timestamp}-${index}`}
              steps={item.steps}
              active={index === items.length - 1}
            />
          );
        }

        const previous = items[index - 1];
        const isSameActor = previous?.type === 'message' && previous.message.actor === item.message.actor;

        return (
          <MessageBlock
            key={`${item.message.actor}-${item.message.timestamp}-${index}`}
            message={item.message}
            isSameActor={isSameActor}
          />
        );
      })}
    </div>
  );
});

interface MessageBlockProps {
  message: StorageMessage;
  isSameActor: boolean;
}

function MessageBlock({ message, isSameActor }: MessageBlockProps) {
  if (!message.actor) {
    console.error('No actor found');
    return <div />;
  }
  const actor = ACTOR_PROFILES[message.actor as keyof typeof ACTOR_PROFILES];
  const isProgress = message.content === 'Showing progress...';
  const isUser = message.actor === 'user';

  return (
    <PromptMessage className={`max-w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`min-w-0 ${isUser ? 'max-w-[84%]' : 'w-full flex-1'}`}>
        {!isSameActor && (
          <div
            className={`mb-1 text-[11px] font-medium uppercase text-zinc-500 ${isUser ? 'text-right' : 'text-left'}`}>
            {isUser ? 'You' : actor.name}
          </div>
        )}

        {isProgress ? (
          <MessageContent className="border border-zinc-800 bg-[#111113] text-zinc-100">
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <FiActivity className="size-4 animate-pulse text-sky-300" />
              <span>Working through the next browser step</span>
            </div>
          </MessageContent>
        ) : (
          <MessageContent
            markdown
            className={`bma-markdown border shadow-sm ${
              isUser
                ? 'bma-markdown-user border-orange-300/25 bg-[#2a211b] text-orange-50'
                : 'border-transparent bg-transparent px-0 py-0 text-zinc-100 shadow-none'
            }`}>
            {message.content}
          </MessageContent>
        )}
      </div>
    </PromptMessage>
  );
}

type ToolCall = {
  id?: string;
  name: string;
  state: ToolPart['state'];
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  errorText?: string;
  rawText?: string;
  timestamp: number;
};

type TraceStep =
  | { type: 'reasoning'; text: string; timestamp: number }
  | { type: 'tools'; calls: ToolCall[]; timestamp: number };

const TOOL_MESSAGE_PREFIX = '__bma_tool_call__:';
const REASONING_MESSAGE_PREFIX = '__bma_reasoning__:';

type DisplayItem = { type: 'message'; message: StorageMessage } | { type: 'trace'; steps: TraceStep[] };

function buildDisplayItems(messages: StorageMessage[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  let traceSteps: TraceStep[] = [];

  const flushTrace = () => {
    if (traceSteps.length > 0) {
      items.push({ type: 'trace', steps: traceSteps });
      traceSteps = [];
    }
  };

  messages.forEach(message => {
    const toolCall = message.actor !== 'user' ? parseToolCall(message.content, message.timestamp) : null;

    if (toolCall) {
      if (toolCall.name !== 'done' && toolCall.name !== 'browser_action') {
        const lastStep = traceSteps[traceSteps.length - 1];
        if (lastStep?.type === 'tools') {
          lastStep.calls = collapseToolCalls([...lastStep.calls, toolCall]);
          lastStep.timestamp = toolCall.timestamp;
        } else {
          traceSteps.push({ type: 'tools', calls: [toolCall], timestamp: toolCall.timestamp });
        }
      }
      return;
    }

    const reasoningText = message.actor !== 'user' ? parseReasoningMessage(message.content) : null;
    if (reasoningText !== null) {
      traceSteps.push({ type: 'reasoning', text: reasoningText, timestamp: message.timestamp });
      return;
    }

    flushTrace();
    items.push({ type: 'message', message });
  });

  flushTrace();
  return items;
}

function collapseToolCalls(calls: ToolCall[]): ToolCall[] {
  const collapsed: ToolCall[] = [];
  const indexByKey = new Map<string, number>();

  calls.forEach(call => {
    if (call.name === 'browser_action') return;

    const key = getToolCallKey(call);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, collapsed.length);
      collapsed.push(call);
      return;
    }

    const existing = collapsed[existingIndex];
    collapsed[existingIndex] = {
      ...existing,
      ...call,
      input: call.input ?? existing.input,
      output: call.output ?? existing.output,
      errorText: call.errorText ?? existing.errorText,
      timestamp: call.timestamp,
    };
  });

  return collapsed;
}

function getToolCallKey(call: ToolCall) {
  if (call.id) return call.id;
  return `${call.name}:${stableStringify(call.input ?? {})}`;
}

function parseToolCall(content: string, timestamp: number): ToolCall | null {
  if (content.startsWith(TOOL_MESSAGE_PREFIX)) {
    try {
      const parsed = JSON.parse(content.slice(TOOL_MESSAGE_PREFIX.length)) as Omit<ToolCall, 'timestamp'>;
      return { ...parsed, name: normalizeToolName(parsed.name), timestamp };
    } catch {
      return null;
    }
  }

  return null;
}

function parseReasoningMessage(content: string): string | null {
  if (!content.startsWith(REASONING_MESSAGE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(content.slice(REASONING_MESSAGE_PREFIX.length)) as { text?: string };
    return parsed.text ?? '';
  } catch {
    return '';
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableStringify(nestedValue)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function RunTrace({ steps, active }: { steps: TraceStep[]; active: boolean }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-1 py-1">
      <ChainOfThought className="pl-1">
        {steps.map((step, index) => (
          <ChainOfThoughtStep
            key={`${step.type}-${step.timestamp}-${index}`}
            defaultOpen={isOpenTraceStep(step, index, steps, active)}
            isLast={index === steps.length - 1}>
            {step.type === 'reasoning' ? (
              <ReasoningStep step={step} active={active && index === steps.length - 1} />
            ) : (
              <ToolGroupStep calls={step.calls} />
            )}
          </ChainOfThoughtStep>
        ))}
      </ChainOfThought>
    </div>
  );
}

function isOpenTraceStep(step: TraceStep, index: number, steps: TraceStep[], active: boolean) {
  return active && index === steps.length - 1 && step.type === 'reasoning';
}

function ReasoningStep({ step, active }: { step: Extract<TraceStep, { type: 'reasoning' }>; active: boolean }) {
  const tokenEstimate = Math.max(1, Math.ceil(step.text.trim().split(/\s+/).filter(Boolean).length * 1.3));
  const contentRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (active && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [active, step.text]);

  return (
    <>
      <ChainOfThoughtTrigger
        leftIcon={
          active ? (
            <FiLoader className="size-3.5 animate-spin text-sky-400" />
          ) : (
            <FiCpu className="size-3.5 text-zinc-500" />
          )
        }>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">Reasoning</span>
          <span className={`shrink-0 text-[11px] ${active ? 'text-sky-300' : 'text-zinc-500'}`}>
            ~{tokenEstimate} tokens
          </span>
        </span>
      </ChainOfThoughtTrigger>
      <ChainOfThoughtContent>
        <ChainOfThoughtItem>
          <pre ref={contentRef} className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs leading-5">
            {step.text}
          </pre>
        </ChainOfThoughtItem>
      </ChainOfThoughtContent>
    </>
  );
}

function ToolGroupStep({ calls }: { calls: ToolCall[] }) {
  if (calls.length === 1) {
    return <SingleToolStep call={calls[0]} />;
  }

  const failed = calls.some(call => call.state === 'output-error');
  const running = calls.some(call => call.state === 'input-streaming');
  const completed = calls.filter(call => call.state === 'output-available').length;
  const label = running
    ? `Running ${calls.length} actions...`
    : failed
      ? `${completed}/${calls.length} actions completed`
      : `Completed ${calls.length} actions`;

  return (
    <>
      <ChainOfThoughtTrigger
        leftIcon={
          running ? (
            <FiLoader className="size-3.5 animate-spin text-sky-400" />
          ) : (
            <FiCheck className="size-3.5 text-emerald-400" />
          )
        }>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{label}</span>
          <span
            className={`shrink-0 text-[11px] ${running ? 'text-sky-300' : failed ? 'text-rose-300' : 'text-emerald-300'}`}>
            {running ? 'running' : failed ? 'review' : 'done'}
          </span>
        </span>
      </ChainOfThoughtTrigger>
      <ChainOfThoughtContent>
        <ChainOfThoughtItem>
          <div className="space-y-2">
            {calls.map((call, index) => (
              <div key={`${call.name}-${call.timestamp}-${index}`} className="flex min-w-0 items-center gap-2 text-sm">
                {getToolIcon(call)}
                <span className="truncate text-zinc-200">{formatToolLabel(call)}</span>
                <span className={`shrink-0 text-[11px] ${getToolStatusClass(call.state)}`}>
                  {getToolStatusLabel(call.state)}
                </span>
              </div>
            ))}
          </div>
        </ChainOfThoughtItem>
      </ChainOfThoughtContent>
    </>
  );
}

function SingleToolStep({ call }: { call: ToolCall }) {
  return (
    <>
      <ChainOfThoughtTrigger leftIcon={getToolIcon(call)}>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{formatToolLabel(call)}</span>
          <span className={`shrink-0 text-[11px] ${getToolStatusClass(call.state)}`}>
            {getToolStatusLabel(call.state)}
          </span>
        </span>
      </ChainOfThoughtTrigger>
      {hasVisibleToolDetails(call) && (
        <ChainOfThoughtContent>
          <ChainOfThoughtItem>
            <ToolDetails call={call.name === 'fill_form_fields' ? { ...call, input: undefined } : call} />
          </ChainOfThoughtItem>
        </ChainOfThoughtContent>
      )}
    </>
  );
}

type PlannedField = {
  index?: number;
  label?: string;
  text?: string;
};

function getPlannedFields(call: ToolCall): PlannedField[] {
  const fields = call.input?.fields;
  if (!Array.isArray(fields)) return [];

  return fields
    .filter((field): field is Record<string, unknown> => Boolean(field) && typeof field === 'object')
    .map(field => ({
      index: typeof field.index === 'number' ? field.index : undefined,
      label: typeof field.label === 'string' ? field.label : undefined,
      text: typeof field.text === 'string' ? field.text : undefined,
    }));
}

function ToolDetails({ call }: { call: ToolCall }) {
  if (call.errorText) return <div className="text-rose-300">{call.errorText}</div>;

  const value = call.output ?? call.input;
  if (!value) return null;

  return <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono">{JSON.stringify(value, null, 2)}</pre>;
}

function hasVisibleToolDetails(call: ToolCall) {
  if (call.name === 'fill_form_fields') {
    return Boolean(call.output || call.errorText);
  }
  return hasToolDetails(call);
}

function hasToolDetails(call: ToolCall) {
  return Boolean(call.input || call.output || call.errorText);
}

function getToolIcon(call: ToolCall) {
  if (call.state === 'output-error') return <FiAlertTriangle className="size-3.5 text-rose-400" />;
  if (call.state === 'input-streaming') return <FiLoader className="size-3.5 animate-spin text-sky-400" />;
  if (call.state === 'output-available') return <FiCheck className="size-3.5 text-emerald-400" />;
  return <FiCompass className="size-3.5" />;
}

function getToolStatusLabel(state: ToolPart['state']) {
  if (state === 'input-streaming') return 'running';
  if (state === 'output-error') return 'failed';
  if (state === 'output-available') return 'done';
  return 'ready';
}

function getToolStatusClass(state: ToolPart['state']) {
  if (state === 'input-streaming') return 'text-sky-300';
  if (state === 'output-error') return 'text-rose-300';
  if (state === 'output-available') return 'text-emerald-300';
  return 'text-zinc-500';
}

function normalizeToolName(name: string) {
  return name
    .replace(/^tool-/, '')
    .trim()
    .toLowerCase();
}

function formatToolName(name: string) {
  return name
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatToolLabel(call: ToolCall) {
  if (call.name === 'fill_form_fields') {
    if (call.state === 'input-streaming') return 'Planning form fill...';
    const fieldCount = getPlannedFields(call).length;
    return `Filled ${fieldCount} form field${fieldCount === 1 ? '' : 's'}`;
  }
  return formatToolName(call.name);
}
