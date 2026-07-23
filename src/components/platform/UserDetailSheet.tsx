import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import type { PlatformUser } from "@/data/platformUsers";

interface Props {
  user: PlatformUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Placeholder detail drawer for a selected platform user. Task 10 fills in
 *  the body (membership management, artist link, admin actions); this stub
 *  only exists so UsersTab's import resolves and tsc passes. */
export function UserDetailSheet({ user, open, onOpenChange }: Props) {
  if (!user) return null;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{user.display_name || user.email || user.id}</SheetTitle>
          <SheetDescription>{user.email}</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
}
