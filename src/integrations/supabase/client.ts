// Originally scaffolded by Lovable ("do not edit directly"); now hand-maintained, since
// the client needs the active-org fetch wrapper below. It is NOT a sync-mirrors target
// (see scripts/mirrors.manifest.json), so nothing regenerates over these edits.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { createActiveOrgFetch } from './activeOrg';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
  global: {
    // Carries the active org as `x-active-org` so the org_isolation RLS policy can
    // narrow rows to the org being viewed. Defense in depth behind the explicit
    // .eq("org_id", …) filters in src/data/** — see ./activeOrg.ts for why both exist.
    // Bound so the wrapper never captures a stale global, and typed as `fetch`
    // itself rather than a spread lambda (which TS cannot match to the overloads).
    fetch: createActiveOrgFetch((input, init) => fetch(input, init)),
  },
});