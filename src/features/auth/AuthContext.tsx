import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';
import type { AppRole } from '@/config/app.config';

const REALTIME_INVALIDATIONS: Array<{ table: string; keys: unknown[][] }> = [
  { table: 'bookings',                   keys: [['bookings']] },
  { table: 'show_dates',                 keys: [['show-dates'], ['dashboard-upcoming-dates']] },
  { table: 'show_date_cast_eligibility', keys: [['show-date-cast-eligibility'], ['eligible-artists']] },
  { table: 'show_cast_eligibility',      keys: [['cast-eligibility'], ['eligible-artists']] },
  { table: 'cast_members',              keys: [['cast-members'], ['artist-casts'], ['my-cast-memberships'], ['cast-members-counts']] },
  { table: 'artists',                    keys: [['artists'], ['my-artist'], ['my-artist-producer']] },
  { table: 'shows',                      keys: [['show'], ['shows-for-eligibility'], ['shows-sub-programs']] },
  { table: 'casts',                      keys: [['casts']] },
  { table: 'cities',                     keys: [['cities']] },
  { table: 'app_settings',               keys: [['app-settings']] },
  { table: 'profiles',                   keys: [['chat-author-profiles']] },
  { table: 'user_approvals',             keys: [['user-approvals'], ['admin-iam-users']] },
  { table: 'chat_messages',              keys: [['chat-messages']] },
  { table: 'chats',                      keys: [['chat'], ['my-chats']] },
  { table: 'booking_audit_log',          keys: [['admin-audit']] },
  { table: 'airtable_sync_log',          keys: [['admin-sync']] },
];

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'unknown';

export interface ViewAsUser {
  id: string;
  email: string;
  roles: AppRole[];
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  loading: boolean;
  approvalStatus: ApprovalStatus;
  approvalReason: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  hasRole: (role: AppRole) => boolean;
  /** Set by EditorContext to simulate a different role in the UI. Never affects DB access. */
  viewAsRole: AppRole | null;
  setViewAsRole: (role: AppRole | null) => void;
  /** Set by editor toolbar to simulate a different user identity in the UI. Never affects DB access. */
  viewAsUser: ViewAsUser | null;
  setViewAsUser: (u: ViewAsUser | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>('unknown');
  const [approvalReason, setApprovalReason] = useState<string | null>(null);
  const [viewAsRole, setViewAsRole] = useState<AppRole | null>(null);
  const [viewAsUser, setViewAsUserState] = useState<ViewAsUser | null>(null);

  const setViewAsUser = (u: ViewAsUser | null) => {
    setViewAsUserState(u);
    if (u) setViewAsRole(null);
  };

  /** Fetch user roles from user_roles table */
  const fetchRoles = async (userId: string) => {
    const { data } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId);
    setRoles(data?.map(r => r.role as AppRole) ?? []);
  };

  /** Fetch approval row; missing row = treat as approved (legacy users). */
  const fetchApproval = async (userId: string) => {
    const { data } = await supabase
      .from('user_approvals')
      .select('status, rejection_reason')
      .eq('user_id', userId)
      .maybeSingle();
    if (!data) {
      setApprovalStatus('approved');
      setApprovalReason(null);
    } else {
      setApprovalStatus(data.status as ApprovalStatus);
      setApprovalReason(data.rejection_reason ?? null);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setTimeout(() => {
            fetchRoles(session.user.id);
            fetchApproval(session.user.id);
          }, 0);
        } else {
          setRoles([]);
          setApprovalStatus('unknown');
          setApprovalReason(null);
          setViewAsRole(null);
          setViewAsUserState(null);
          localStorage.removeItem('showflow_editor_mode');
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchRoles(session.user.id);
        fetchApproval(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Realtime: react to approval decisions immediately
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`user-approval-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'user_approvals', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const next = payload.new as { status: ApprovalStatus; rejection_reason: string | null };
          setApprovalStatus(next.status);
          setApprovalReason(next.rejection_reason);
          // Refresh roles since approval may have just granted one
          fetchRoles(user.id);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  // Realtime: global cache invalidation for all queried tables
  useEffect(() => {
    if (!user) return;
    const channels = REALTIME_INVALIDATIONS.map(({ table, keys }) =>
      supabase
        .channel(`rt-${table}`)
        .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
          keys.forEach(key => queryClient.invalidateQueries({ queryKey: key }));
        })
        .subscribe()
    );
    return () => { channels.forEach(ch => supabase.removeChannel(ch)); };
  }, [user, queryClient]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) throw error;
  };

  const signOut = async () => {
    setViewAsRole(null);
    setViewAsUserState(null);
    localStorage.removeItem('showflow_editor_mode');
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const hasRole = (role: AppRole) => {
    if (viewAsUser) return viewAsUser.roles.includes(role);
    if (viewAsRole !== null) return role === viewAsRole;
    return roles.includes(role);
  };

  return (
    <AuthContext.Provider value={{ user, session, roles, loading, approvalStatus, approvalReason, signIn, signInWithGoogle, signOut, hasRole, viewAsRole, setViewAsRole, viewAsUser, setViewAsUser }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Returns the effective user id for identity-scoped queries (impersonation-aware). */
export function useEffectiveUserId(): string | undefined {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useEffectiveUserId must be used within AuthProvider');
  return ctx.viewAsUser?.id ?? ctx.user?.id;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
