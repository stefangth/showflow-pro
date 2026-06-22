import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** The current user's full personal-data export document (GDPR access/portability). */
export async function exportMyData(client: SupabaseClient<Database>): Promise<unknown> {
  const { data, error } = await client.rpc("export_my_data");
  if (error) throw error;
  return data;
}

/** Permanently delete the current user's account (anonymize-and-retain + auth delete). */
export async function deleteMyAccount(client: SupabaseClient<Database>): Promise<void> {
  const { data, error } = await client.functions.invoke("delete-my-account", { body: {} });
  if (error) throw error;
  const payload = data as { error?: string; org_name?: string } | null;
  if (payload?.error) {
    if (payload.error === "last_admin") {
      throw new Error(
        `You are the last admin of ${payload.org_name ?? "an organization"}. ` +
          `Appoint another admin or have the organization deleted first.`,
      );
    }
    // Translate the edge function's internal error codes into a user-facing message.
    const FRIENDLY: Record<string, string> = {
      verify_failed: "We couldn't verify your account state. Please try again.",
      anonymize_failed: "Something went wrong removing your data. No account was deleted — please try again.",
      delete_failed: "Your data was removed but the account couldn't be deleted. Please contact support.",
    };
    throw new Error(FRIENDLY[payload.error] ?? payload.error);
  }
}
