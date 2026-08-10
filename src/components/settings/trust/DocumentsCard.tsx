import { FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DOCUMENTS, DOCUMENTS_NOTE } from "@/lib/trust/facts";

/** The documents that exist. Nothing here is a placeholder for a PDF we have
 *  not written: the DPA is a mailto, and it says "Request" rather than
 *  "Download" so the label matches what happens. */
export function DocumentsCard() {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold tracking-tight">Documents</h3>
          <span className="font-mono text-xs text-muted-foreground">{DOCUMENTS_NOTE}</span>
        </div>
        <ul>
          {DOCUMENTS.map((doc) => {
            const isMail = doc.href.startsWith("mailto:");
            return (
              <li
                key={doc.title}
                className="flex items-center justify-between gap-3 border-t border-border py-2.5"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{doc.title}</span>
                    <span className="block font-mono text-xs text-muted-foreground">{doc.meta}</span>
                  </span>
                </span>
                <a
                  href={doc.href}
                  {...(isMail ? { rel: "noreferrer" } : { target: "_blank", rel: "noreferrer" })}
                  className="shrink-0 whitespace-nowrap font-mono text-xs text-primary hover:underline"
                >
                  {doc.cta}
                </a>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
