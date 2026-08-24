import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { DOCUMENTS, DOCUMENTS_NOTE } from "@/lib/trust/facts";

/** The documents that exist. Nothing here is a placeholder for a PDF we have
 *  not written: the DPA is a mailto, and it says "Request" rather than
 *  "Download" so the label matches what happens. */
export function DocumentsCard() {
  const { t } = useTranslation('settingsTrust');
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        {/* The same header every other card on this tab uses (see
         *  RetentionCard): an <h3> over a muted <p>. It used to be a
         *  non-wrapping flex row with the lede on the right, which put a 24px
         *  heading against a two-line block with neither baseline aligned at
         *  1440, and squeezed the heading to ~138px beside a three-line note
         *  at 375. It was also the only running prose in `font-mono` here. */}
        <h3 className="text-base font-semibold tracking-tight">{t('documentsCard.title')}</h3>
        <p className="text-sm text-muted-foreground">{DOCUMENTS_NOTE}</p>
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
                    {/* Never truncate: at a 1024px viewport "Data processing
                     *  agreement" rendered as "Data processing…". A documents
                     *  list on a trust page cannot elide the document's name —
                     *  the title is what a reviewer is here to identify. It
                     *  wraps instead. */}
                    <span className="block text-sm font-medium">{doc.title}</span>
                    <span className="block text-xs text-muted-foreground">{doc.meta}</span>
                  </span>
                </span>
                <a
                  href={doc.href}
                  {...(isMail ? { rel: "noreferrer" } : { target: "_blank", rel: "noreferrer" })}
                  className="shrink-0 whitespace-nowrap text-xs text-primary hover:underline"
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
