import { useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ROUTES } from '@/config/app.config';
import { useConsent } from '@/features/consent/ConsentContext';
import privacyEN from '../../docs/legal/privacy-policy.en.md?raw';
import privacyDE from '../../docs/legal/privacy-policy.de.md?raw';

type Lang = 'en' | 'de';

export default function PrivacyPage() {
  const [lang, setLang] = useState<Lang>('en');
  const { openPreferences } = useConsent();
  const content = lang === 'en' ? privacyEN : privacyDE;

  return (
    <main className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <Link to={ROUTES.LOGIN} className="text-sm text-muted-foreground hover:text-foreground underline">
            ← Back to sign in
          </Link>
          <div className="flex gap-2">
            <Button
              variant={lang === 'en' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLang('en')}
            >
              EN
            </Button>
            <Button
              variant={lang === 'de' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLang('de')}
            >
              DE
            </Button>
          </div>
        </div>

        <Card className="p-8">
          <article className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-display prose-table:text-xs prose-th:text-left">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </article>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          <button
            onClick={openPreferences}
            className="underline hover:text-foreground"
          >
            Manage cookie preferences
          </button>
          {' · '}
          <Link to={ROUTES.IMPRESSUM} className="underline hover:text-foreground">
            Impressum
          </Link>
        </p>
      </div>
    </main>
  );
}
