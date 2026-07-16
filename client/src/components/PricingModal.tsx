import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import PricingTable from "@/components/PricingTable";
import { type PlanId } from "@shared/plans";
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
  title = "Your tour video is ready",
  subtitle = "Choose Starter, Creator, or Studio with monthly or yearly billing.",
}: PricingModalProps) {
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] w-[min(97vw,72rem)] !max-w-none overflow-y-auto rounded-3xl border-ring/40 bg-background/95 p-5 backdrop-blur-xl sm:p-8">
        <div className="text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Unlock your video
          </span>
          <DialogTitle className="mt-3 font-display text-2xl text-foreground sm:text-3xl">
            {title}
          </DialogTitle>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            {subtitle}
          </p>
        </div>

        <PricingTable
          compact
          onSelectPlan={onSelectPlan}
          loadingPlan={loadingPlan}
          onLoadingPlanChange={setLoadingPlan}
        />

        <p className="mt-5 text-center text-xs text-muted-foreground">
          Secure checkout by Stripe · Subscriptions renew automatically · Cancel
          anytime
        </p>
      </DialogContent>
    </Dialog>
  );
}
