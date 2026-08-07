import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Eye } from 'lucide-react';

const EMAIL_TEMPLATE_KEYS = [
  'cast-escalation-requested',
  'artist-offer-digest',
  'artist-confirmation-digest',
  'offer-immediate',
  'offer-expiry-reminder',
  'hire-order-issued',
] as const;
type EmailTemplateKey = typeof EMAIL_TEMPLATE_KEYS[number];

const EMAIL_TEMPLATE_LABELS: Record<EmailTemplateKey, string> = {
  'cast-escalation-requested': 'Cast Escalation Requested',
  'artist-offer-digest': 'Artist Offer Digest',
  'artist-confirmation-digest': 'Artist Confirmation Digest',
  'offer-immediate': 'Immediate Offer',
  'offer-expiry-reminder': 'Offer Expiry Reminder',
  'hire-order-issued': 'Hire Order Issued',
};

export function EmailTemplatesCard({ get, set, readOnly = false }: { get: (key: string, fallback?: unknown) => unknown; set: (key: string, value: unknown) => void; readOnly?: boolean }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewTitle, setPreviewTitle] = useState('');

  const overrides: Record<string, Record<string, string>> = (get('email_template_overrides', {}) ?? {}) as Record<string, Record<string, string>>;

  function setOverride(templateKey: string, field: string, value: string) {
    const next = { ...overrides, [templateKey]: { ...(overrides[templateKey] ?? {}), [field]: value } };
    set('email_template_overrides', next);
  }

  async function handlePreview(templateKey: EmailTemplateKey) {
    setPreviewLoading(true);
    setPreviewTitle(EMAIL_TEMPLATE_LABELS[templateKey]);
    setPreviewOpen(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? '';
      const { data, error } = await supabase.functions.invoke('preview-transactional-email', {
        body: { templateName: templateKey, overrides: overrides[templateKey] ?? {} },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;
      const tmpl = data?.templates?.[0];
      setPreviewHtml(tmpl?.html ?? '<p>No preview available</p>');
    } catch (e) {
      setPreviewHtml(`<p style="color:red">Preview failed: ${(e as Error)?.message ?? String(e)}</p>`);
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="font-display">Email Templates</CardTitle>
          <CardDescription>
            Override subject, intro, CTA label, and footer for each transactional email. Leave blank to use the built-in default.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          {EMAIL_TEMPLATE_KEYS.map(templateKey => (
            <div key={templateKey} className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-display font-semibold text-sm">{EMAIL_TEMPLATE_LABELS[templateKey]}</h4>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePreview(templateKey)}
                >
                  <Eye className="h-3.5 w-3.5 mr-1.5" />
                  Preview
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Subject</Label>
                  <Input
                    placeholder="Default subject"
                    value={(overrides[templateKey]?.subject) ?? ''}
                    disabled={readOnly}
                    onChange={e => setOverride(templateKey, 'subject', e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">CTA label</Label>
                  <Input
                    placeholder="Default CTA label"
                    value={(overrides[templateKey]?.cta_label) ?? ''}
                    disabled={readOnly}
                    onChange={e => setOverride(templateKey, 'cta_label', e.target.value)}
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Intro text</Label>
                  <Input
                    placeholder="Default intro text"
                    value={(overrides[templateKey]?.intro) ?? ''}
                    disabled={readOnly}
                    onChange={e => setOverride(templateKey, 'intro', e.target.value)}
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">Footer text</Label>
                  <Input
                    placeholder="Default footer text"
                    value={(overrides[templateKey]?.footer) ?? ''}
                    disabled={readOnly}
                    onChange={e => setOverride(templateKey, 'footer', e.target.value)}
                  />
                </div>
              </div>
              <Separator />
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl w-full">
          <DialogHeader>
            <DialogTitle>Preview · {previewTitle}</DialogTitle>
          </DialogHeader>
          {previewLoading ? (
            <div className="flex items-center justify-center h-64 text-muted-foreground">Rendering preview…</div>
          ) : (
            <iframe
              srcDoc={previewHtml}
              className="w-full border border-border rounded-lg"
              style={{ height: '520px' }}
              sandbox="allow-same-origin"
              title="Email preview"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
