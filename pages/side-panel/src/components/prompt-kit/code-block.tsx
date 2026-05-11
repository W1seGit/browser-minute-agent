/* eslint-disable @typescript-eslint/no-unused-vars */
import React from 'react';
import { cn } from './utils';

export type CodeBlockProps = {
  children?: React.ReactNode;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

export function CodeBlock({ children, className, ...props }: CodeBlockProps) {
  return (
    <div
      className={cn(
        'not-prose flex w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0b0f14] text-white',
        className,
      )}
      {...props}>
      {children}
    </div>
  );
}

export type CodeBlockCodeProps = {
  code: string;
  language?: string;
  theme?: string;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

export function CodeBlockCode({
  code,
  language = 'tsx',
  theme: _theme = 'github-dark',
  className,
  ...props
}: CodeBlockCodeProps) {
  return (
    <div className={cn('w-full overflow-x-auto text-[13px]', className)} {...props}>
      <div className="border-b border-white/10 px-4 py-2 text-[11px] uppercase tracking-[0.14em] text-white/45">
        {language || 'text'}
      </div>
      <pre className="px-4 py-4 text-[#d6e0ea]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export type CodeBlockGroupProps = React.HTMLAttributes<HTMLDivElement>;

export function CodeBlockGroup({ children, className, ...props }: CodeBlockGroupProps) {
  return (
    <div className={cn('flex items-center justify-between', className)} {...props}>
      {children}
    </div>
  );
}
