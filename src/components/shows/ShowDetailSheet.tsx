import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';
import ShowDetailPage from '@/pages/ShowDetailPage';

interface Props {
  showId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShowDetailSheet({ showId, open, onOpenChange }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-3xl lg:max-w-4xl overflow-y-auto p-0">
        <div className="sticky top-0 z-10 bg-background border-b border-border px-6 py-3 flex items-center justify-between">
          <SheetHeader className="text-left">
            <SheetTitle className="font-display text-base">Show details</SheetTitle>
          </SheetHeader>
          {showId && (
            <Link to={`/shows/${showId}`}>
              <Button variant="outline" size="sm">
                <ExternalLink className="h-4 w-4 mr-2" />Open full page
              </Button>
            </Link>
          )}
        </div>
        <div className="p-6">
          {showId && <ShowDetailPage idOverride={showId} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
