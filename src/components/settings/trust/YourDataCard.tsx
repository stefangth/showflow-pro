import { Link } from "react-router-dom";
import { Download, Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/app.config";
import { BACKUP_CEILING_NOTE, TRUST_CONTACT } from "@/lib/trust/facts";

/** Export and deletion, described as they actually work today.
 *
 *  The source design put an "Export organisation data" button here. There is no
 *  such thing: `export-org-data` and `delete_org` both require a platform
 *  administrator, so an org admin cannot run either. Rather than draw a button
 *  that would 403, this card sends people to the export that does exist (their
 *  own, on the profile page) and states plainly that the organisation-wide one
 *  is a request. */
export function YourDataCard() {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h3 className="text-base font-semibold tracking-tight">Export and deletion</h3>
        <p className="text-sm text-muted-foreground">
          Your own data is a button. An organisation-wide export or deletion is a request we answer
          within one month, because it needs a platform administrator to run.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild size="sm">
            <Link to={ROUTES.PROFILE}>
              <Download className="mr-2 h-3.5 w-3.5" />
              Export your data
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <a
              href={`mailto:${TRUST_CONTACT}?subject=Organisation%20data%20request`}
              rel="noreferrer"
            >
              <Mail className="mr-2 h-3.5 w-3.5" />
              Request an organisation export
            </a>
          </Button>
        </div>
        {/* The backup sentence is imported, not retyped: the same string ships
         *  in the Backups control, the Retention card and the public page, so
         *  lowering the ceiling moves all four at once. */}
        <p className="text-xs leading-4 text-muted-foreground">
          Deleting your account anonymises what booking records must retain, then removes the
          account. {BACKUP_CEILING_NOTE}
        </p>
      </CardContent>
    </Card>
  );
}
