import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { setActiveOrg } from '@/integrations/supabase/activeOrg';
import type { User, Session } from '@supabase/supabase-js';
import type { AppRole } from '@/config/app.config';
import { fetchMyMemberships, type Membership, type Organization } from '@/data/orgs';
import { fetchIsSuperAdmin, fetchAllOrgs } from '@/data/platform';
import { rolesForOrg, effectiveHasRole, effectiveOrgs } from './orgRoles';
import { REALTIME_INVALIDATIONS } from './realtimeInvalidations';
import { resolveSessionIdentity, computeAuthReady, bootstrapAuth, type SessionIdentityHandlers } from './sessionState';
import { maybeDevAutoLogin } from './devAutoLogin';

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
  const [viewAsRole, setViewAsRole] = useState<AppRole | null>(null);
  const [viewAsUser, setViewAsUserState] = useState<ViewAsUser | null>(null);
  // Readiness is DERIVED, not an imperatively-toggled flag: `bootstrapped` flips
  // once the initial session check settles, and `identityUserId` is the user id
  // identity is currently loaded for. `loading` below is computed from these so
  // no render can treat a half-loaded identity as authoritative. See sessionState.ts.
  const [bootstrapped, setBootstrapped] = useState(false);
  const [identityUserId, setIdentityUserId] = useState<string | null>(null);
  // Tracks whether any real resolution has landed, so a failed initial-session
  // bootstrap can't clobber a good signed-in state an auth event already set.
  const resolvedRef = useRef(false);

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

  // Mirror the active org onto every PostgREST request, so the org_isolation policy
  // can narrow rows server-side (see integrations/supabase/activeOrg.ts). Tracks the
  // DERIVED currentOrg, not currentOrgId, because the latter is null until a switch
  // and the effective org falls back to orgs[0]. Assigned during render rather than
  // in an effect: effects run after children mount, so the first query of a newly
  // entered org would otherwise go out under the previous org's header. The setter
  // is an idempotent write to a module variable, so a double render is harmless.
  setActiveOrg(currentOrg?.id ?? null);

  // `loading` for route guards: true until identity is resolved for the current
  // user. Derived so the sign-in / account-switch flash is impossible by
  // construction (user changes → not ready until identity catches up), not raced
  // away by toggling a flag at the right moment. See computeAuthReady.
  const loading = !computeAuthReady(bootstrapped, user?.id ?? null, identityUserId);

  const switchOrg = (orgId: string) => {
    setCurrentOrgId(orgId);
    localStorage.setItem('showflow.currentOrg', orgId);
    // An impersonated user is an identity inside the org being LEFT: their roles are
    // membership-scoped, and they would not appear in the new org's user list, so the
    // UI offers no way to clear a stale one. Reset here rather than at each call site —
    // the sidebar switcher, the editor toolbar, the platform console's "enter org" and
    // the suspended-org screen all route through this function.
    setViewAsUserState(null);
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

  /** Reset all identity + impersonation state for a signed-out session. */
  const clearIdentity = () => {
    setMemberships([]);
    setCurrentOrgId(null);
    setIsSuperAdmin(false);
    setAllOrgs([]);
    localStorage.removeItem('showflow.currentOrg');
    setViewAsRole(null);
    setViewAsUserState(null);
    localStorage.removeItem('showflow_editor_mode');
  };

  /**
   * Flip readiness once identity has settled for `userId` (null when signed out).
   * Called from resolveSessionIdentity's finally — strictly after loadIdentity /
   * clearIdentity — so `loading` only clears when identity for the current user
   * is in place (isSuperAdmin/currentOrg populated), never mid-load.
   */
  const markResolved = (userId: string | null) => {
    resolvedRef.current = true;
    setIdentityUserId(userId);
    setBootstrapped(true);
  };

  useEffect(() => {
    // session/user are set synchronously (plain setters are lock-safe). The
    // async identity load runs inside resolveSessionIdentity, which calls
    // markResolved once it settles. Guards read the DERIVED `loading` (see
    // computeAuthReady), so the moment `user` changes they show the spinner
    // until identity for that user is loaded — no flag to sequence, no flash.
    const identityHandlers: SessionIdentityHandlers = { loadIdentity, clearIdentity, markResolved };
    // Flipped on unmount so the bootstrap's retry/backoff loop stops touching
    // state against a dead provider (StrictMode double-invoke, HMR, test remounts).
    let cancelled = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        // Defer only the identity load: it issues Supabase calls, which can
        // deadlock if run synchronously inside the auth state-change callback.
        setTimeout(() => { void resolveSessionIdentity(session, identityHandlers); }, 0);
      }
    );

    // Initial-session bootstrap, hardened against a stalled auth lock. Under
    // multi-tab contention getSession() can time out or hang; awaiting it once
    // with no catch (the old code) stranded the guards on the spinner forever.
    // bootstrapAuth retries with backoff and, failing that, degrades to
    // signed-out so the app can never spin indefinitely. See sessionState.ts.
    void bootstrapAuth({
      getSession: async () => (await supabase.auth.getSession()).data.session,
      applySession: (session) => {
        setSession(session);
        setUser(session?.user ?? null);
      },
      resolve: (session) => resolveSessionIdentity(session, identityHandlers),
      // Abandon the bootstrap once the provider unmounts, or once any real
      // resolution has landed (e.g. an onAuthStateChange event beat the retries)
      // — so a slow attempt can neither clobber a good signed-in state nor keep
      // retrying. onAuthStateChange stays subscribed, so the app self-heals the
      // moment the lock frees.
      shouldAbort: () => cancelled || resolvedRef.current,
      // Last resort when the session can never be established (a deadlocked
      // cross-tab auth lock): settle as signed-out so the guards leave the
      // spinner instead of hanging forever. bootstrapAuth only calls this when
      // shouldAbort() is false, so it never clobbers an already-resolved state.
      degrade: () => {
        setSession(null);
        setUser(null);
        clearIdentity();
        markResolved(null);
      },
    });

    // DEV-ONLY: auto sign-in on the local Vite dev server when opted in via
    // `VITE_DEV_AUTOLOGIN=true` (+ VITE_DEV_AUTOLOGIN_EMAIL/PASSWORD in .env), so
    // gated routes render without the login screen. `import.meta.env.DEV` is
    // statically false in every production build, so Vite dead-strips this whole
    // block (and the credential reads) from deployed bundles — it can never run
    // on a hosted server. onAuthStateChange (subscribed above) picks up the
    // resulting session. See devAutoLogin.ts for the full safety model.
    if (import.meta.env.DEV) {
      void maybeDevAutoLogin(supabase.auth, {
        optedIn: import.meta.env.VITE_DEV_AUTOLOGIN === 'true',
        email: import.meta.env.VITE_DEV_AUTOLOGIN_EMAIL as string | undefined,
        password: import.meta.env.VITE_DEV_AUTOLOGIN_PASSWORD as string | undefined,
      });
    }

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
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
