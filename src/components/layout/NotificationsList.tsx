import type { MouseEvent } from 'react';
import { Bell, CheckCheck, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from '@/hooks/useNotifications';
import { notificationTarget } from '@/lib/notifications/entityRoutes';
import { useAuth } from '@/features/auth/AuthContext';
import { useEditorConfig } from '@/features/editor/EditorContext';
import { formatDistanceToNow } from 'date-fns';

export interface NotificationsListProps {
  /** Called after a click navigates somewhere — lets the host close the popover
   *  it's rendered inside instead of leaving it open over the new page. Not
   *  called for a click that only marks a notification read. */
  onNavigate?: () => void;
}

export function NotificationsList({ onNavigate }: NotificationsListProps = {}) {
  const { data: notifications = [], isLoading } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const navigate = useNavigate();
  const { roles, isSuperAdmin } = useAuth();
  // The active org's Editor Mode page-access overrides — the SAME registry
  // ProtectedRoute reads — so a deep link never promises a route this org has
  // reconfigured this role out of (or leaves an org-granted role stranded).
  const { pageAccess } = useEditorConfig();

  const unread = notifications.filter(n => !n.read);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-control font-semibold">Notifications</span>
        {unread.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            className="h-6 px-2 text-eyebrow text-muted-foreground"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
          >
            <CheckCheck className="h-3 w-3 mr-1" />
            Mark all read
          </Button>
        )}
      </div>

      {/* List */}
      <div className="max-h-80 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
            <Bell className="h-8 w-8 opacity-30" />
            <p className="text-control">No notifications yet</p>
          </div>
        ) : (
          notifications.map(n => {
            const target = notificationTarget(n, { roles, isSuperAdmin, pageAccess });
            const handleClick = (e: MouseEvent<HTMLElement>) => {
              if (!n.read) markRead.mutate(n.id);
              if (!target) return;
              // A modified click (cmd/ctrl/shift-click) signals "open in a new tab": let
              // the anchor's real href handle that natively instead of hijacking it with
              // an in-app SPA navigate in the current tab, which the popover would then
              // have no reason to close. Middle-click never reaches this branch at all —
              // see handleAuxClick below for why.
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              navigate(target);
              onNavigate?.();
            };
            // Middle-click fires the DOM `auxclick` event, not `click`, in every evergreen
            // browser, so the guard above never runs for it: the row's real href still
            // opens a new tab (native anchor behavior, left alone here same as a modified
            // left-click), but nothing would otherwise mark the notification read. This
            // handler covers exactly that gap and only that gap: it never navigates, since
            // the browser already owns opening the new tab. button 2 (right-click) also
            // reaches `auxclick` in some browsers but opens a context menu the user may
            // cancel, so it is left alone.
            const handleAuxClick = (e: MouseEvent<HTMLElement>) => {
              if (e.button === 1 && !n.read) markRead.mutate(n.id);
            };
            const rowClassName = cn(
              'block w-full text-left px-4 py-3 border-b border-border last:border-0 transition-colors',
              n.read
                ? 'hover:bg-muted'
                : 'bg-[var(--notification-unread)] hover:bg-[var(--notification-unread)]',
            );
            const rowContent = (
              <div className="flex items-start gap-2">
                {!n.read && (
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                    aria-hidden="true"
                  />
                )}
                <div className={cn("flex-1 min-w-0", n.read && "pl-3.5")}>
                  <p className="text-control font-medium truncate">{n.title}</p>
                  {n.message && (
                    <p className="text-caption text-muted-foreground line-clamp-2 mt-0.5">{n.message}</p>
                  )}
                  <p className="text-eyebrow text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </p>
                </div>
                {/* Signals the row goes somewhere on click, so "so what happens now"
                    has a visible answer instead of a dead-end popover item. The chevron
                    itself is aria-hidden (purely visual); the sr-only span carries the
                    same signal into the row's accessible name for screen readers and
                    touch users, who never see a hover title. */}
                {target && (
                  <>
                    <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                    <span className="sr-only">Opens the related page</span>
                  </>
                )}
              </div>
            );
            // A real <a href> when there's a destination — a plain <button> has no href,
            // so cmd/middle-click, hover-preview, and "copy link address" all silently do
            // nothing. A target-less notification has nowhere to send any of those, so it
            // stays a <button> instead of an anchor with no href to give.
            return target ? (
              <a key={n.id} href={target} onClick={handleClick} onAuxClick={handleAuxClick} className={rowClassName}>
                {rowContent}
              </a>
            ) : (
              <button key={n.id} onClick={handleClick} className={rowClassName}>
                {rowContent}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
