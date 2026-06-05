import { z } from "zod";

/** Read the `type` param (recovery|invite|…) from a URL hash like `#access_token=…&type=recovery`. */
export function parseRecoveryHash(hash: string): { type: string | null } {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  return { type: new URLSearchParams(h).get("type") };
}

/** Return `redirect` only when it is a safe in-app relative path; otherwise `fallback`. */
export function safeRelativeRedirect(redirect: string | null, fallback: string): string {
  return redirect && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : fallback;
}

export const newPasswordSchema = z
  .object({ password: z.string().min(8, "At least 8 characters"), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "Passwords don't match", path: ["confirm"] });
