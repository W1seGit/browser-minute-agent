import type { Message as StorageMessage } from '@extension/storage';
import { ACTOR_PROFILES } from '../types/message';
import { memo } from 'react';
import { FiActivity, FiAlertTriangle, FiCheck, FiCompass, FiLoader } from 'react-icons/fi';
import { Message as PromptMessage, MessageAvatar, MessageContent } from './prompt-kit/message';
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
        if (item.type === 'tools') {
          return <ToolCallChain key={`tools-${item.calls[0]?.timestamp}-${index}`} calls={item.calls} />;
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
      {!isUser && !isSameActor && (
        <MessageAvatar src={actor.icon} alt={actor.name} fallback="AI" className="border border-zinc-800 bg-zinc-950" />
      )}
      {!isUser && isSameActor && <div className="w-8 shrink-0" />}

      <div className={`min-w-0 ${isUser ? 'max-w-[84%]' : 'max-w-[calc(100%-2.75rem)] flex-1'}`}>
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
                ? 'bma-markdown-user border-orange-300/30 bg-zinc-100 text-zinc-950'
                : 'border-zinc-800 bg-[#111113] text-zinc-100'
            }`}>
            {message.content}
          </MessageContent>
        )}
        {!isProgress && (
          <div className={`mt-1 text-xs text-zinc-500 ${isUser ? 'text-right' : 'text-left'}`}>
            {formatTimestamp(message.timestamp)}
          </div>
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

const TOOL_MESSAGE_PREFIX = '__bma_tool_call__:';

type DisplayItem = { type: 'message'; message: StorageMessage } | { type: 'tools'; calls: ToolCall[] };

function buildDisplayItems(messages: StorageMessage[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  let toolGroup: ToolCall[] = [];

  const flushTools = () => {
    if (toolGroup.length > 0) {
      const collapsed = collapseToolCalls(toolGroup);
      if (collapsed.length > 0) {
        items.push({ type: 'tools', calls: collapsed });
      }
      toolGroup = [];
    }
  };

  messages.forEach(message => {
    const toolCall = message.actor !== 'user' ? parseToolCall(message.content, message.timestamp) : null;

    if (toolCall) {
      if (toolCall.name !== 'done' && toolCall.name !== 'browser_action') {
        toolGroup.push(toolCall);
      }
      return;
    }

    flushTools();
    items.push({ type: 'message', message });
  });

  flushTools();
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

function ToolCallChain({ calls }: { calls: ToolCall[] }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-1 py-1">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase text-zinc-500">
        <FiCompass className="size-3.5" />
        Browser actions
        <span className="ml-auto normal-case text-zinc-600">{formatTimestamp(calls[calls.length - 1].timestamp)}</span>
      </div>
      <ChainOfThought className="pl-1">
        {calls.map((call, index) => (
          <ChainOfThoughtStep key={`${call.name}-${call.timestamp}-${index}`} isLast={index === calls.length - 1}>
            <ChainOfThoughtTrigger leftIcon={getToolIcon(call)}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{formatToolName(call.name)}</span>
                <span className={`shrink-0 text-[11px] ${getToolStatusClass(call.state)}`}>
                  {getToolStatusLabel(call.state)}
                </span>
              </span>
            </ChainOfThoughtTrigger>
            {hasToolDetails(call) && (
              <ChainOfThoughtContent>
                <ChainOfThoughtItem>
                  <ToolDetails call={call} />
                </ChainOfThoughtItem>
              </ChainOfThoughtContent>
            )}
          </ChainOfThoughtStep>
        ))}
      </ChainOfThought>
    </div>
  );
}

function ToolDetails({ call }: { call: ToolCall }) {
  if (call.errorText) return <div className="text-rose-300">{call.errorText}</div>;

  const value = call.output ?? call.input;
  if (!value) return null;

  return <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono">{JSON.stringify(value, null, 2)}</pre>;
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

/**
 * Formats a timestamp (in milliseconds) to a readable time string
 * @param timestamp Unix timestamp in milliseconds
 * @returns Formatted time string
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();

  // Check if the message is from today
  const isToday = date.toDateString() === now.toDateString();

  // Check if the message is from yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  // Check if the message is from this year
  const isThisYear = date.getFullYear() === now.getFullYear();

  // Format the time (HH:MM)
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isToday) {
    return timeStr; // Just show the time for today's messages
  }

  if (isYesterday) {
    return `Yesterday, ${timeStr}`;
  }

  if (isThisYear) {
    // Show month and day for this year
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
  }

  // Show full date for older messages
  return `${date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}, ${timeStr}`;
}
