import { FiAlertCircle, FiCheckCircle, FiClock, FiLoader, FiTerminal } from 'react-icons/fi';
import { cn } from './utils';

export type ToolPart = {
  type: string;
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error' | string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  toolCallId?: string;
  errorText?: string;
};

export type ToolProps = {
  toolPart: ToolPart;
  defaultOpen?: boolean;
  className?: string;
};

const stateConfig = {
  'input-streaming': {
    label: 'Running',
    icon: FiLoader,
    className: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
  },
  'input-available': {
    label: 'Ready',
    icon: FiClock,
    className: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-200',
  },
  'output-available': {
    label: 'Completed',
    icon: FiCheckCircle,
    className: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  },
  'output-error': {
    label: 'Error',
    icon: FiAlertCircle,
    className: 'border-rose-400/30 bg-rose-400/10 text-rose-200',
  },
};

export function Tool({ toolPart, defaultOpen = false, className }: ToolProps) {
  const config = stateConfig[toolPart.state as keyof typeof stateConfig] ?? stateConfig['input-available'];
  const StatusIcon = config.icon;
  const hasDetails = Boolean(toolPart.input || toolPart.output || toolPart.errorText);

  return (
    <details
      open={defaultOpen}
      className={cn(
        'group overflow-hidden rounded-lg border border-zinc-800 bg-[#111113] shadow-sm shadow-black/20',
        className,
      )}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/[0.04] [&::-webkit-details-marker]:hidden">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-zinc-800 bg-zinc-950 text-zinc-300">
          <FiTerminal className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-zinc-100">{formatToolName(toolPart.type)}</span>
          {toolPart.toolCallId && (
            <span className="block truncate font-mono text-[11px] text-zinc-500">{toolPart.toolCallId}</span>
          )}
        </span>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium',
            config.className,
          )}>
          <StatusIcon className={cn('size-3.5', toolPart.state === 'input-streaming' && 'animate-spin')} />
          {config.label}
        </span>
      </summary>

      {hasDetails && (
        <div className="border-t border-zinc-800 bg-zinc-950/60 px-3 py-3">
          {toolPart.input && <JsonPanel label="Input" value={toolPart.input} />}
          {toolPart.output && <JsonPanel label="Output" value={toolPart.output} />}
          {toolPart.errorText && (
            <div className="mt-3 rounded-md border border-rose-400/20 bg-rose-400/10 p-3 text-xs text-rose-100">
              {toolPart.errorText}
            </div>
          )}
        </div>
      )}
    </details>
  );
}

function JsonPanel({ label, value }: { label: string; value: Record<string, unknown> }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 text-[11px] font-medium uppercase text-zinc-500">{label}</div>
      <pre className="max-h-52 overflow-auto rounded-md border border-zinc-800 bg-black/40 p-3 font-mono text-xs leading-5 text-zinc-300">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function formatToolName(name: string) {
  return name
    .replace(/^tool-/, '')
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
