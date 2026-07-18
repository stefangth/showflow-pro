import type { UseQueryResult } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** The single sanctioned cast from a test stub to the app's client type.
 *  Build the whole stub as plain objects, cast ONCE here at the boundary. */
export function asSupabase(fake: unknown): SupabaseClient<Database> {
  return fake as SupabaseClient<Database>;
}

/** Build a UseQueryResult from only the fields the test asserts on. */
export function asQueryResult<T>(
  partial: Partial<UseQueryResult<T, Error>>,
): UseQueryResult<T, Error> {
  return partial as UseQueryResult<T, Error>;
}

/** Cast a partial object to T for module/hook mocks — keys are checked
 *  against T (typos fail), presence is not. */
export function partialMock<T>(partial: Partial<T>): T {
  return partial as T;
}
