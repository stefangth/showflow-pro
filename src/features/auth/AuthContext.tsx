import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';
import type { AppRole } from '@/config/app.config';
import { fetchMyMemberships, type Membership, type Organization } from '@/data/orgs';
import { fetchIsSuperAdmin, fetchAllOrgs } from '@/data/platform';
import { rolesForOrg, effectiveHasRole, effectiveOrgs } from './orgRoles';

/**
 * Realtime table → query-key invalidations. Keys are prefix-matched by React Query,
 * so a top-level key (e.g. ['shows']) busts every sub-key under it (['shows','list',id], …).
 * Every listed prefix MUST correspond to a real `useQuery` key somewhere in src — a typo'd
 * or renamed key silently no-ops and breaks cross-client propagation. Exported for testing.
 */
export const REALTIME_INVALIDATIONS: Array<{ table: string; keys: unknown[][] }> = [
  { table: 'bookings',                   keys: [['bookings']] },
  { table: 'show_dates',                 keys: [['show-dates'], ['dashboard-upcoming-dates'], ['artist-eligible-dates']] },
  { table: 'show_date_cast_eligibility', keys: [['show-date-cast-eligibility'], ['eligible-artists'], ['artist-eligible-dates']] },
  { table: 'show_cast_eligibility',      keys: [['cast-eligibility'], ['eligible-artists'], ['artist-eligible-dates']] },
  { table: 'cast_members',              keys: [['cast-members'], ['artist-casts'], ['my-cast-memberships'], ['cast-members-counts'], ['eligible-artists'], ['artist-eligible-dates']] }, // cast membership drives both eligibility queries
  { table: 'artists',                    keys: [['artists'], ['my-artist']] },
  { table: 'shows',                      keys: [['shows'], ['shows-for-eligibility'], ['shows-program-sub-programs']] },
  { table: 'casts',                      keys: [['casts']] },
  { table: 'cities',                     keys: [['cities']] },
  { table: 'app_settings',               keys: [['app-settings']] },
  { table: 'profiles',                   keys: [['chat-author-profiles']] },
  { table: 'chat_messages',              keys: [['chat-messages']] },
  { table: 'chats',                      keys: [['chat'], ['my-chats']] },
  { table: 'booking_audit_log',          keys: [['admin-audit']] },
  { table: 'airtable_sync_log',          keys: [['admin-sync']] },
];

export interface ViewAsUser {
  id: string;
  email: string;
  roles: AppRole[];
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  /** Org memberships for the signed-in user (all orgs). */
  memberships: Membership[];
  /** Organizations the user belongs to (deduped). */
  orgs: Organization[];
  /** The active organization (switcher selection), or null if the user has none. */
  currentOrg: Organization | null;
  /** True if the signed-in user is a platform (super) admin. */
  isSuperAdmin: boolean;
  /** Switch the active org; persists the choice and refetches org-scoped data. */
  switchOrg: (orgId: string) => void;
  /** Re-fetch memberships/orgs for the signed-in user (e.g. after an org rename). */
  refreshOrgs: () => Promise<void>;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
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
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(
    () => localStorage.getItem('showflow.currentOrg'),
  );
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [allOrgs, setAllOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewAsRole, setViewAsRole] = useState<AppRole | null>(null);
  const [viewAsUser, setViewAsUserState] = useState<ViewAsUser | null>(null);

  const setViewAsUser = (u: ViewAsUser | null) => {
    setViewAsUserState(u);
    if (u) setViewAsRole(null);
  };

  const membershipOrgs = useMemo<Organization[]>(() => {
    const byId = new Map<string, Organization>();
    for (const m of memberships) if (m.organizations) byId.set(m.organizations.id, m.organizations);
    return Array.from(byId.values());
  }, [memberships]);

  const orgs = effectiveOrgs(isSuperAdmin, allOrgs, membershipOrgs);
  const currentOrg = orgs.find((o) => o.id === currentOrgId) ?? orgs[0] ?? null;
  /** Roles are scoped to the active org, so hasRole() keeps its signature. */
  const roles = rolesForOrg(memberships, currentOrg?.id ?? null);

  const switchOrg = (orgId: string) => {
    setCurrentOrgId(orgId);
    localStorage.setItem('showflow.currentOrg', orgId);
    queryClient.invalidateQueries();
  };

  const refreshOrgs = async () => {
    if (user?.id) await loadIdentity(user.id);
  };

  /** Fetch memberships + super-admin status (+ all orgs for super-admins); default the active org. */
  const loadIdentity = async (userId: string) => {
    try {
      const data = await fetchMyMemberships(supabase, userId);
      setMemberships(data);
      setCurrentOrgId((prev) => prev ?? data[0]?.org_id ?? null);
    } catch {
      setMemberships([]);
    }
    try {
      const su = await fetchIsSuperAdmin(supabase, userId);
      setIsSuperAdmin(su);
      setAllOrgs(su ? await fetchAllOrgs(supabase) : []);
    } catch {
      setIsSuperAdmin(false);
      setAllOrgs([]);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setTimeout(() => {
            loadIdentity(session.user.id);
          }, 0);
        } else {
          setMemberships([]);
          setCurrentOrgId(null);
          setIsSuperAdmin(false);
          setAllOrgs([]);
          localStorage.removeItem('showflow.currentOrg');
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
        loadIdentity(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

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

  const signOut = async () => {
    setViewAsRole(null);
    setViewAsUserState(null);
    localStorage.removeItem('showflow_editor_mode');
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const hasRole = (role: AppRole) =>
    effectiveHasRole({ isSuperAdmin, viewAsUser, viewAsRole, roles, role });

  return (
    <AuthContext.Provider value={{ user, session, roles, memberships, orgs, currentOrg, isSuperAdmin, switchOrg, refreshOrgs, loading, signIn, signOut, hasRole, viewAsRole, setViewAsRole, viewAsUser, setViewAsUser }}>
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
