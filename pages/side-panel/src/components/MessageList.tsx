import type { Message as StorageMessage } from '@extension/storage';
import { ACTOR_PROFILES } from '../types/message';
import { memo } from 'react';
import { FiCheckCircle, FiChevronDown, FiMousePointer, FiTerminal } from 'react-icons/fi';
import { Message as PromptMessage, MessageAvatar, MessageContent } from './prompt-kit/message';
import { Steps, StepsBar, StepsContent, StepsItem, StepsTrigger } from './prompt-kit/steps';

interface MessageListProps {
  messages: StorageMessage[];
  isDarkMode?: boolean;
}

export default memo(function MessageList({ messages, isDarkMode = false }: MessageListProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-3 py-5">
      {messages.map((message, index) => (
        <MessageBlock
          key={`${message.actor}-${message.timestamp}-${index}`}
          message={message}
          isSameActor={index > 0 ? messages[index - 1].actor === message.actor : false}
          isDarkMode={isDarkMode}
        />
      ))}
    </div>
  );
});

interface MessageBlockProps {
  message: StorageMessage;
  isSameActor: boolean;
  isDarkMode?: boolean;
}

function MessageBlock({ message, isSameActor, isDarkMode = false }: MessageBlockProps) {
  if (!message.actor) {
    console.error('No actor found');
    return <div />;
  }
  const actor = ACTOR_PROFILES[message.actor as keyof typeof ACTOR_PROFILES];
  const isProgress = message.content === 'Showing progress...';
  const isUser = message.actor === 'user';
  const toolCall = parseToolCall(message.content);

  if (toolCall && !isUser) {
    return <ToolCallStep call={toolCall} timestamp={message.timestamp} />;
  }

  return (
    <PromptMessage className={`max-w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && !isSameActor && (
        <MessageAvatar
          src={actor.icon}
          alt={actor.name}
          fallback="AI"
          className="border border-white/10 bg-[#151b23]"
        />
      )}
      {!isUser && isSameActor && <div className="w-8 shrink-0" />}

      <div className={`min-w-0 ${isUser ? 'max-w-[84%]' : 'max-w-[calc(100%-2.75rem)] flex-1'}`}>
        {!isSameActor && (
          <div
            className={`mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-[#7d8794] ${isUser ? 'text-right' : 'text-left'}`}>
            {isUser ? 'You' : actor.name}
          </div>
        )}

        {isProgress ? (
          <MessageContent className="border border-white/10 bg-[#111820] text-white">
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full animate-progress bg-[#6ee7d8]" />
            </div>
          </MessageContent>
        ) : (
          <MessageContent
            markdown
            className={`bma-markdown border shadow-sm ${
              isUser
                ? 'bma-markdown-user border-[#6ee7d8]/25 bg-[#6ee7d8] text-[#062b28]'
                : 'border-white/10 bg-[#111820] text-[#e7eef7]'
            }`}>
            {message.content}
          </MessageContent>
        )}
        {!isProgress && (
          <div className={`mt-1 text-xs text-[#7d8794] ${isUser ? 'text-right' : 'text-left'}`}>
            {formatTimestamp(message.timestamp)}
          </div>
        )}
      </div>
    </PromptMessage>
  );
}

type ToolCall = {
  name: string;
  label: string;
  details: string;
};

function parseToolCall(content: string): ToolCall | null {
  const match = content.match(/^([a-zA-Z_][\w-]*):\s*([\s\S]+)$/);
  if (!match) return null;

  const [, name, rawDetails] = match;
  if (!name.includes('_') && !rawDetails.trim().startsWith('{')) return null;

  let label = name
    .split(/[_-]/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  let details = rawDetails.trim();

  try {
    const parsed = JSON.parse(details);
    label = parsed.intent || parsed.text || label;
    details = Object.entries(parsed)
      .filter(([key]) => key !== 'intent')
      .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join('\n');
  } catch {
    // Keep raw details when the action payload is not JSON.
  }

  return { name, label, details };
}

function ToolCallStep({ call, timestamp }: { call: ToolCall; timestamp: number }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-3">
      <Steps defaultOpen={false} className="rounded-2xl border border-white/10 bg-[#0f151d] px-3 py-2">
        <StepsTrigger
          leftIcon={
            call.name.includes('click') ? <FiMousePointer className="size-4" /> : <FiTerminal className="size-4" />
          }
          className="min-w-0 text-[#d6e0ea]">
          <span className="min-w-0 flex-1 truncate text-left">{call.label}</span>
          <span className="ml-auto hidden shrink-0 items-center gap-1 text-xs text-[#7d8794] min-[420px]:flex">
            <FiCheckCircle className="size-3.5 text-[#55d98f]" />
            {formatTimestamp(timestamp)}
          </span>
          <FiChevronDown className="size-4 shrink-0 text-[#7d8794]" />
        </StepsTrigger>
        <StepsContent bar={<StepsBar className="bg-[#2c3744]" />}>
          <StepsItem className="text-xs text-[#7d8794]">{call.name}</StepsItem>
          {call.details && (
            <StepsItem className="whitespace-pre-wrap rounded-xl bg-[#090d12] p-3 font-mono text-xs text-[#b9c5d1]">
              {call.details}
            </StepsItem>
          )}
        </StepsContent>
      </Steps>
    </div>
  );
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
