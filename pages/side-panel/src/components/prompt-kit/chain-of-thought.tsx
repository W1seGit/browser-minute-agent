/* eslint-disable react/prop-types */
import React, { createContext, useContext, useState } from 'react';
import { FiChevronDown } from 'react-icons/fi';
import { cn } from './utils';

const ChainStepContext = createContext<{ open: boolean; setOpen: (open: boolean) => void }>({
  open: false,
  setOpen: () => {},
});

export type ChainOfThoughtProps = {
  children: React.ReactNode;
  className?: string;
};

export function ChainOfThought({ children, className }: ChainOfThoughtProps) {
  return <div className={cn('space-y-0', className)}>{children}</div>;
}

export type ChainOfThoughtStepProps = {
  children: React.ReactNode;
  className?: string;
  defaultOpen?: boolean;
  isLast?: boolean;
};

export function ChainOfThoughtStep({
  children,
  className,
  defaultOpen = false,
  isLast = false,
}: ChainOfThoughtStepProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <ChainStepContext.Provider value={{ open, setOpen }}>
      <div
        className={cn('relative grid grid-cols-[1rem_minmax(0,1fr)] gap-3', className)}
        data-state={open ? 'open' : 'closed'}>
        <div className="flex justify-center">
          <span className="mt-2 size-2 rounded-full bg-zinc-500" />
          {!isLast && <span className="absolute bottom-0 top-5 w-px bg-zinc-800" />}
        </div>
        <div className="min-w-0 pb-3">{children}</div>
      </div>
    </ChainStepContext.Provider>
  );
}

export type ChainOfThoughtTriggerProps = React.ComponentProps<'button'> & {
  leftIcon?: React.ReactNode;
  swapIconOnHover?: boolean;
};

export function ChainOfThoughtTrigger({
  children,
  className,
  leftIcon,
  swapIconOnHover = true,
  ...props
}: ChainOfThoughtTriggerProps) {
  const { open, setOpen } = useContext(ChainStepContext);

  return (
    <button
      type="button"
      className={cn(
        'group flex min-h-7 w-full cursor-pointer items-center gap-2 text-left text-sm text-zinc-300 transition-colors hover:text-zinc-100',
        className,
      )}
      onClick={() => setOpen(!open)}
      {...props}>
      {leftIcon && (
        <span className="relative inline-flex size-4 shrink-0 items-center justify-center text-zinc-500">
          <span className={cn('transition-opacity', swapIconOnHover && 'group-hover:opacity-0')}>{leftIcon}</span>
          {swapIconOnHover && (
            <FiChevronDown
              className={cn('absolute size-4 opacity-0 transition group-hover:opacity-100', open && 'rotate-180')}
            />
          )}
        </span>
      )}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

export type ChainOfThoughtContentProps = React.ComponentProps<'div'>;

export function ChainOfThoughtContent({ children, className, ...props }: ChainOfThoughtContentProps) {
  const { open } = useContext(ChainStepContext);
  if (!open) return null;

  return (
    <div
      className={cn('mt-2 rounded-md border border-zinc-800 bg-black/20 p-2 text-xs text-zinc-400', className)}
      {...props}>
      {children}
    </div>
  );
}

export type ChainOfThoughtItemProps = React.ComponentProps<'div'>;

export function ChainOfThoughtItem({ children, className, ...props }: ChainOfThoughtItemProps) {
  return (
    <div className={cn('min-w-0', className)} {...props}>
      {children}
    </div>
  );
}
