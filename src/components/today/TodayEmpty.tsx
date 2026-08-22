import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TodayEmptyProps {
  fillingOnTheirOwn: number;
  onLookAtSeason: () => void;
}

/** Empty state (prototype lines 231-238): nothing needs a human right now. */
export function TodayEmpty({ fillingOnTheirOwn, onLookAtSeason }: TodayEmptyProps) {
  const { t } = useTranslation("today");

  return (
    <div className="rounded-[var(--radius-xl)] border border-dashed border-border px-8 py-11 text-center">
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--green-100)] text-[var(--green-600)]">
        <Check className="h-5 w-5" />
      </span>
      <p className="m-0 mt-3.5 text-title font-semibold tracking-[-0.3px]">{t("empty.title")}</p>
      <p className="mx-auto mb-0 mt-2 max-w-[420px] text-control leading-5 text-muted-foreground">
        {t("empty.body", { count: fillingOnTheirOwn })}
      </p>
      <Button variant="secondary" onClick={onLookAtSeason} className="mt-[18px]">
        {t("empty.cta")}
      </Button>
    </div>
  );
}
