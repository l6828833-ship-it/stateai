import { Clapperboard, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { planForStoredId } from "@shared/plans";
import { cn } from "@/lib/utils";

const TIER_RATES = [
  { tier: "starter", label: "Starter", price: 17 },
  { tier: "creator", label: "Pro", price: 14 },
  { tier: "studio", label: "Premium", price: 10 },
] as const;

interface PayAsYouGoCardProps {
  currentPlan?: string | null;
  subscribed?: boolean;
  additionalVideoPriceUsd?: number;
  onAction: () => void;
  actionLabel?: string;
  className?: string;
  compact?: boolean;
}

export default function PayAsYouGoCard({
  currentPlan,
  subscribed = false,
  additionalVideoPriceUsd,
  onAction,
  actionLabel,
  className,
  compact = false,
}: PayAsYouGoCardProps) {
  const plan = planForStoredId(currentPlan);
  const currentRate = additionalVideoPriceUsd;

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-3xl border border-zinc-200 bg-zinc-950 text-white shadow-[0_24px_70px_-38px_rgba(24,24,27,.8)]",
        compact ? "p-5" : "p-6 sm:p-8",
        className
      )}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(255,255,255,.15),transparent_35%)]" />
      <div className="relative grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80">
            <Zap className="h-3.5 w-3.5" /> Pay as you go
          </span>
          <h3 className="mt-4 font-display text-2xl text-white">
            Need one more listing video?
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55">
            Keep your plan and add a single video whenever volume spikes. Your
            tier automatically gets its lower additional-video rate.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {TIER_RATES.map(rate => {
              const active = plan?.tier === rate.tier;
              return (
                <span
                  key={rate.tier}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-xs",
                    active
                      ? "border-white bg-white font-semibold text-zinc-950"
                      : "border-white/10 bg-white/5 text-white/65"
                  )}
                >
                  {rate.label} · ${rate.price}/video
                  {active && " · your rate"}
                </span>
              );
            })}
          </div>
        </div>
        <div className="relative lg:text-right">
          {subscribed ? (
            currentRate ? (
              <p className="mb-3 text-sm text-white/60">
                Your price:{" "}
                <strong className="text-xl text-white">${currentRate}</strong>
              </p>
            ) : (
              <p className="mb-3 text-sm text-white/60">
                Your exact tier rate loads securely at checkout.
              </p>
            )
          ) : (
            <Clapperboard className="mb-3 h-7 w-7 text-white/60 lg:ml-auto" />
          )}
          <Button
            type="button"
            onClick={onAction}
            className="btn-springy rounded-full bg-white px-6 text-zinc-950 hover:bg-zinc-200"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {actionLabel ??
              (subscribed ? "Buy additional video" : "Choose a plan")}
          </Button>
        </div>
      </div>
    </section>
  );
}
