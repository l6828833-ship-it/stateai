import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PLANS, type PlanId } from "@shared/plans";
import { Check, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

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
  subtitle = "Unlock it — and every video after it — with a plan that fits how you sell.",
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
      <DialogContent className="max-h-[92vh] w-[min(96vw,64rem)] !max-w-none overflow-y-auto rounded-3xl border-ring/40 bg-background/95 p-6 backdrop-blur-xl sm:p-10">
        <div className="text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" /> Unlock your video
          </span>
          <DialogTitle className="mt-3 font-display text-2xl text-foreground sm:text-3xl">
            {title}
          </DialogTitle>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{subtitle}</p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={cn(
                "relative flex flex-col rounded-2xl border p-5 transition-all duration-300",
                plan.highlighted
                  ? "border-primary bg-accent/50 pink-glow scale-[1.02]"
                  : "border-border bg-card/80 hover:border-ring",
              )}
            >
              {plan.badge && (
                <span
                  className={cn(
                    "absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    plan.highlighted
                      ? "bg-primary text-primary-foreground"
                      : "bg-foreground text-background",
                  )}
                >
                  {plan.badge}
                </span>
              )}
              <h3 className="font-display text-base text-foreground">{plan.name}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{plan.tagline}</p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="font-display text-3xl text-foreground">${plan.price}</span>
                <span className="text-sm text-muted-foreground">
                  /{plan.interval === "year" ? "yr" : "mo"}
                </span>
              </div>
              <ul className="mt-4 flex-1 space-y-2">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                onClick={() => handleSelect(plan.id)}
                disabled={loadingPlan !== null}
                variant={plan.highlighted ? "default" : "outline"}
                className={cn(
                  "btn-springy mt-5 w-full rounded-full",
                  !plan.highlighted && "bg-card hover:bg-accent",
                )}
              >
                {loadingPlan === plan.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  `Choose ${plan.name}`
                )}
              </Button>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Secure checkout by Stripe · Cancel anytime from your billing portal
        </p>
      </DialogContent>
    </Dialog>
  );
}
