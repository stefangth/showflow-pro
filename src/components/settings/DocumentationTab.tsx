import appLogicMd from '../../../docs/app-logic.md?raw';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MarkdownDoc } from "./MarkdownDoc";

/** Read-only app-logic guide rendered from docs/app-logic.md. No state. */
export function DocumentationTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">App Logic Guide</CardTitle>
        <CardDescription>
          How ShowFlow works: roles, data model, eligibility, and the full availability → booking flow.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <MarkdownDoc source={appLogicMd} />
      </CardContent>
    </Card>
  );
}
