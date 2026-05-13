import { Markdown } from './markdown';
import { cn } from './utils';

export type MessageProps = {
  children: React.ReactNode;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

export const Message = ({ children, className, ...props }: MessageProps) => (
  <div className={cn('flex gap-3', className)} {...props}>
    {children}
  </div>
);

export type MessageAvatarProps = {
  src?: string;
  alt: string;
  fallback?: string;
  className?: string;
};

export const MessageAvatar = ({ src, alt, fallback, className }: MessageAvatarProps) => (
  <div
    className={cn(
      'flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#111113] text-xs font-semibold text-white',
      className,
    )}>
    {src ? <img src={src} alt={alt} className="size-full object-cover" /> : fallback}
  </div>
);

export type MessageContentProps = {
  children: React.ReactNode;
  markdown?: boolean;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

export const MessageContent = ({ children, markdown = false, className, ...props }: MessageContentProps) => {
  const classNames = cn('break-words whitespace-normal rounded-lg px-4 py-3 text-[15px] leading-7', className);

  const markdownContent = typeof children === 'string' || typeof children === 'number' ? String(children) : undefined;

  return markdown ? (
    markdownContent === undefined ? (
      <div className={classNames} {...props}>
        {children}
      </div>
    ) : (
      <Markdown className={classNames} {...props}>
        {markdownContent}
      </Markdown>
    )
  ) : (
    <div className={classNames} {...props}>
      {children}
    </div>
  );
};

export type MessageActionsProps = {
  children: React.ReactNode;
  className?: string;
} & React.HTMLProps<HTMLDivElement>;

export const MessageActions = ({ children, className, ...props }: MessageActionsProps) => (
  <div className={cn('flex items-center gap-2 text-[#7d8794]', className)} {...props}>
    {children}
  </div>
);

export type MessageActionProps = {
  className?: string;
  tooltip: React.ReactNode;
  children: React.ReactNode;
};

export const MessageAction = ({ tooltip, children, className }: MessageActionProps) => (
  <span className={cn('inline-flex', className)} title={typeof tooltip === 'string' ? tooltip : undefined}>
    {children}
  </span>
);
