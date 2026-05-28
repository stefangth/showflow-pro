import { useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ROUTES } from '@/config/app.config';
import impressumEN from '../../docs/legal/impressum.en.md?raw';
import impressumDE from '../../docs/legal/impressum.de.md?raw';

type Lang = 'de' | 'en';

export default function ImpressumPage() {
  const [lang, setLang] = useState<Lang>('de');
  const content = lang === 'de' ? impressumDE : impressumEN;

  return (
    <main className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <Link to={ROUTES.LOGIN} className="text-sm text-muted-foreground hover:text-foreground underline">
            ← Back to sign in
          </Link>
          <div className="flex gap-2">
            <Button
              variant={lang === 'de' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLang('de')}
            >
              DE
            </Button>
            <Button
              variant={lang === 'en' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setLang('en')}
            >
              EN
            </Button>
          </div>
        </div>

        <Card className="p-8">
          <article className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-display">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </article>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          <Link to={ROUTES.PRIVACY} className="underline hover:text-foreground">
            Privacy policy
          </Link>
        </p>
      </div>
    </main>
  );
}
