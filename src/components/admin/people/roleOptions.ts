import type { AppRole } from "@/config/app.config";

/**
 * The assignable org roles, in display order. Shared by the invite selects
 * (InviteBar, BulkInviteDialog) and the member role editor (MemberRow) so the
 * three role lists in this feature can't drift out of sync.
 */
export const ROLE_OPTIONS: AppRole[] = ["admin", "producer", "artist"];
