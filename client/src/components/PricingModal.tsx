import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import PricingCards from "@/components/PricingCards";
import type { PlanId } from "@shared/plans";
import { Sparkles } from "lucide-react";

interface PricingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPlan: (planId: PlanId) => Promise<void> | void;
  title?: string;
  subtitle?: string;
}

export default function PricingModal({
  open,
  onOpenChange,
  onSelectPlan,
  title = "Choose the plan that fits your studio",
  subtitle = "Three flexible tiers, available monthly or yearly. Every plan includes high-quality 1080p exports with no watermark.",
}: PricingModalProps) {
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);

  const handleSelect = async (planId: PlanId) => {
    setLoadingPlan(planId);
    try {
      await onSelectPlan(planId);
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] w-[min(97vw,72rem)] !max-w-none overflow-y-auto rounded-3xl border-zinc-200 bg-[#fffafb]/95 p-5 backdrop-blur-2xl sm:p-8">
        <div className="text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-white">
            <Sparkles className="h-3.5 w-3.5" /> Limited launch pricing
          </span>
          <DialogTitle className="mt-3 font-display text-2xl text-foreground sm:text-3xl">
            {title}
          </DialogTitle>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
            {subtitle}
          </p>
        </div>

        <PricingCards
          className="mt-7"
          compact
          loadingPlan={loadingPlan}
          onSelectPlan={handleSelect}
        />
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Secure checkout by Stripe · Subscriptions renew automatically · Cancel
          anytime
        </p>
      </DialogContent>
    </Dialog>
  );
}
