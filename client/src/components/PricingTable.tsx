import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  ADDITIONAL_VIDEO_PRICE_USD,
  PLANS,
  type BillingCadence,
  type Plan,
  type PlanId,
  type PlanTier,
} from "@shared/plans";
import { Check, Loader2, Sparkles } from "lucide-react";

const PROMOTION_END = new Date("2026-08-01T00:00:00Z").getTime();

function promotionTimeLeft() {
  const remaining = Math.max(0, PROMOTION_END - Date.now());
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining / 3_600_000) % 24);
  const minutes = Math.floor((remaining / 60_000) % 60);
  const seconds = Math.floor((remaining / 1_000) % 60);
  return { remaining, days, hours, minutes, seconds };
}

const VALUE_FALLBACKS: Record<
  PlanTier,
  { yearlyDiscount: number; aLaCarteValue: number; aLaCarteDiscount: number }
> = {
  starter: { yearlyDiscount: 26, aLaCarteValue: 51, aLaCarteDiscount: 24 },
  creator: { yearlyDiscount: 27, aLaCarteValue: 136, aLaCarteDiscount: 35 },
  studio: { yearlyDiscount: 25, aLaCarteValue: 340, aLaCarteDiscount: 47 },
};

interface PricingTableProps {
  onSelectPlan?: (planId: PlanId) => Promise<void> | void;
  initialCadence?: BillingCadence;
  loadingPlan?: PlanId | null;
  onLoadingPlanChange?: (planId: PlanId | null) => void;
  compact?: boolean;
}

function PlanPrice({ plan }: { plan: Plan }) {
  if (plan.cadence === "month") {
    return (
      <div className="mt-5 flex items-end gap-1">
        <span className="text-4xl font-bold tracking-tight">
          ${plan.totalPrice}
        </span>
        <span className="pb-1 text-sm text-muted-foreground">/mo</span>
      </div>
    );
  }

  return (
    <div className="mt-5">
      <div className="flex items-end gap-1">
        <span className="text-4xl font-bold tracking-tight">
          ${plan.monthlyEquivalent}
        </span>
        <span className="pb-1 text-sm text-muted-foreground">/mo</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        ${plan.totalPrice.toLocaleString()} billed yearly
      </p>
    </div>
  );
}

export default function PricingTable({
  onSelectPlan,
  initialCadence = "month",
  loadingPlan: controlledLoadingPlan,
  onLoadingPlanChange,
  compact = false,
}: PricingTableProps) {
  const [cadence, setCadence] = useState<BillingCadence>(initialCadence);
  const [localLoadingPlan, setLocalLoadingPlan] = useState<PlanId | null>(null);
  const [promotion, setPromotion] = useState(promotionTimeLeft);
  const loadingPlan =
    controlledLoadingPlan === undefined
      ? localLoadingPlan
      : controlledLoadingPlan;

  useEffect(() => {
    const timer = window.setInterval(
      () => setPromotion(promotionTimeLeft()),
      1_000
    );
    return () => window.clearInterval(timer);
  }, []);
  const visiblePlans = useMemo(
    () => PLANS.filter(plan => plan.cadence === cadence),
    [cadence]
  );

  const setLoading = (planId: PlanId | null) => {
    setLocalLoadingPlan(planId);
    onLoadingPlanChange?.(planId);
  };

  const handleSelect = async (planId: PlanId) => {
    if (!onSelectPlan) return;
    setLoading(planId);
    try {
      await onSelectPlan(planId);
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="w-full">
      {promotion.remaining > 0 && (
        <div className="mx-auto mb-5 flex max-w-3xl flex-col items-center justify-between gap-3 rounded-2xl border border-zinc-700 bg-gradient-to-r from-zinc-950 via-zinc-800 to-zinc-950 px-5 py-3 text-white shadow-lg sm:flex-row">
          <div className="text-center sm:text-left">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-zinc-300">
              Launch value event · save up to 47%
            </p>
            <p className="mt-0.5 text-xs text-zinc-400">
              Versus the displayed à la carte value · campaign ends Aug 1 UTC
            </p>
          </div>
          <div
            className="flex items-center gap-1.5"
            aria-label="Promotion time remaining"
          >
            {[
              [promotion.days, "days"],
              [promotion.hours, "hrs"],
              [promotion.minutes, "min"],
              [promotion.seconds, "sec"],
            ].map(([value, label]) => (
              <div
                key={label}
                className="min-w-12 rounded-xl bg-white/10 px-2 py-1.5 text-center backdrop-blur-sm"
              >
                <strong className="block text-sm tabular-nums">
                  {String(value).padStart(2, "0")}
                </strong>
                <span className="text-[9px] uppercase text-zinc-400">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex justify-center">
        <Tabs
          value={cadence}
          onValueChange={value => setCadence(value as BillingCadence)}
        >
          <TabsList className="h-11 rounded-full p-1">
            <TabsTrigger className="rounded-full px-5" value="month">
              Monthly
            </TabsTrigger>
            <TabsTrigger className="rounded-full px-5" value="year">
              Yearly{" "}
              <span className="ml-1 text-[10px] font-bold text-emerald-600">
                SAVE 25%+
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div
        className={cn(
          "mt-8 grid gap-5 lg:grid-cols-3",
          compact && "mt-6 gap-4"
        )}
      >
        {visiblePlans.map(plan => {
          const values = VALUE_FALLBACKS[plan.tier];
          const yearlyDiscount =
            plan.yearlyDiscountPercent || values.yearlyDiscount;
          const aLaCarteValue =
            plan.aLaCarteMonthlyValue || values.aLaCarteValue;
          const aLaCarteDiscount =
            plan.discountVsALaCartePercent || values.aLaCarteDiscount;
          const featured = plan.tier === "creator";
          return (
            <article
              key={plan.id}
              className={cn(
                "relative flex min-w-0 flex-col rounded-3xl border p-6 shadow-sm transition-transform",
                featured
                  ? "border-zinc-800 bg-zinc-950 text-white shadow-xl lg:-translate-y-2"
                  : "border-border bg-card text-card-foreground",
                compact && "p-5"
              )}
            >
              {featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-zinc-700 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white">
                  <Sparkles className="mr-1 inline h-3 w-3" /> Most popular
                </div>
              )}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-xl">{plan.name}</h3>
                  <p
                    className={cn(
                      "mt-1 text-sm",
                      featured ? "text-zinc-400" : "text-muted-foreground"
                    )}
                  >
                    {plan.includedVideos} videos every month
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-semibold",
                    featured
                      ? "bg-white/10 text-zinc-200"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {aLaCarteDiscount}% off value
                </span>
              </div>

              <PlanPrice plan={plan} />
              <div
                className={cn(
                  "mt-4 grid grid-cols-2 gap-2 rounded-2xl p-3 text-xs",
                  featured
                    ? "bg-white/5 text-zinc-300"
                    : "bg-muted/60 text-muted-foreground"
                )}
              >
                <span>À la carte value</span>
                <strong className="text-right text-current line-through decoration-2 opacity-70">
                  ${aLaCarteValue}/mo
                </strong>
                {cadence === "year" && (
                  <>
                    <span>Yearly savings</span>
                    <strong className="text-right text-emerald-500">
                      {yearlyDiscount}%
                    </strong>
                  </>
                )}
              </div>

              <ul className="mt-5 flex-1 space-y-2.5">
                {plan.features.map(feature => (
                  <li
                    key={feature}
                    className={cn(
                      "flex items-start gap-2 text-sm",
                      featured ? "text-zinc-300" : "text-muted-foreground"
                    )}
                  >
                    <Check
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0",
                        featured ? "text-white" : "text-primary"
                      )}
                    />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              {onSelectPlan && (
                <Button
                  className={cn(
                    "mt-6 w-full rounded-full",
                    featured && "bg-white text-zinc-950 hover:bg-zinc-200"
                  )}
                  variant={featured ? "default" : "outline"}
                  disabled={loadingPlan !== null}
                  onClick={() => void handleSelect(plan.id)}
                >
                  {loadingPlan === plan.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    `Choose ${plan.name}`
                  )}
                </Button>
              )}
            </article>
          );
        })}
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Need more? Additional videos are ${ADDITIONAL_VIDEO_PRICE_USD} each,
        flat across every tier.
      </p>
    </div>
  );
}
