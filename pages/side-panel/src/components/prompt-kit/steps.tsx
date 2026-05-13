/* eslint-disable react/prop-types */
import React, { createContext, useContext, useState } from 'react';
import { FiChevronDown } from 'react-icons/fi';
import { cn } from './utils';

const StepsContext = createContext<{ open: boolean; setOpen: (open: boolean) => void }>({
  open: true,
  setOpen: () => {},
});

export type StepsProps = {
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
} & React.ComponentProps<'div'>;

export function Steps({ defaultOpen = true, className, children, ...props }: StepsProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <StepsContext.Provider value={{ open, setOpen }}>
      <div className={cn(className)} data-state={open ? 'open' : 'closed'} {...props}>
        {children}
      </div>
    </StepsContext.Provider>
  );
}

export type StepsTriggerProps = React.ComponentProps<'button'> & {
  leftIcon?: React.ReactNode;
  swapIconOnHover?: boolean;
};

export function StepsTrigger({
  children,
  className,
  leftIcon,
  onClick,
  swapIconOnHover = true,
  ...props
}: StepsTriggerProps) {
  const { open, setOpen } = useContext(StepsContext);
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setOpen(!open);
    onClick?.(event);
  };

  return (
    <button
      type="button"
      className={cn(
        'group flex w-full cursor-pointer items-center justify-start gap-1 text-sm text-[#8b96a5] transition-colors hover:text-white',
        className,
      )}
      onClick={handleClick}
      data-state={open ? 'open' : 'closed'}
      {...props}>
      <div className="flex min-w-0 items-center gap-2">
        {leftIcon ? (
          <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
            <span className={cn('transition-opacity', swapIconOnHover && 'group-hover:opacity-0')}>{leftIcon}</span>
            {swapIconOnHover && (
              <FiChevronDown
                className={cn('absolute size-4 opacity-0 transition group-hover:opacity-100', open && 'rotate-180')}
              />
            )}
          </span>
        ) : null}
        <span className="truncate">{children}</span>
      </div>
      {!leftIcon && <FiChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />}
    </button>
  );
}

export type StepsContentProps = React.ComponentProps<'div'> & {
  bar?: React.ReactNode;
};

export function StepsContent({ children, className, bar, ...props }: StepsContentProps) {
  const { open } = useContext(StepsContext);
  if (!open) return null;

  return (
    <div className={cn('overflow-hidden text-white', className)} {...props}>
      <div className="mt-3 grid max-w-full min-w-0 grid-cols-[min-content_minmax(0,1fr)] items-start gap-x-3">
        <div className="min-w-0 self-stretch">{bar ?? <StepsBar />}</div>
        <div className="min-w-0 space-y-2">{children}</div>
      </div>
    </div>
  );
}

export type StepsBarProps = React.HTMLAttributes<HTMLDivElement>;

export function StepsBar({ className, ...props }: StepsBarProps) {
  return <div className={cn('h-full w-px bg-white/12', className)} aria-hidden {...props} />;
}

export type StepsItemProps = React.ComponentProps<'div'>;

export function StepsItem({ children, className, ...props }: StepsItemProps) {
  return (
    <div className={cn('text-sm text-[#9aa5b3]', className)} {...props}>
      {children}
    </div>
  );
}
