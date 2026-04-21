import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface Props {
  body: string;
  createdAt: string;
  authorName: string;
  isMe: boolean;
}

export function MessageBubble({ body, createdAt, authorName, isMe }: Props) {
  return (
    <div className={cn('flex flex-col gap-1', isMe ? 'items-end' : 'items-start')}>
      <div className="flex items-center gap-2 px-1">
        <span className="text-xs font-medium">{isMe ? 'You' : authorName}</span>
        <span className="text-xs text-muted-foreground">{format(new Date(createdAt), 'HH:mm')}</span>
      </div>
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words',
          isMe ? 'bg-primary text-primary-foreground rounded-br-sm' : 'bg-muted rounded-bl-sm'
        )}
      >
        {body}
      </div>
    </div>
  );
}
