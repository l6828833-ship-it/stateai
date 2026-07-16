import { useEffect, useMemo, useState } from "react";
import { Check, Clock3, Loader2, Sparkles } from "lucide-react";
import {
  PROMOTIONAL_CYCLE_HOURS,
  PROMOTIONAL_DISCOUNT_PERCENT,
  plansForInterval,
  type BillingInterval,
  type PlanId,
} from "@shared/plans";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PROMO_CYCLE_MS = PROMOTIONAL_CYCLE_HOURS * 60 * 60 * 1000;
const PROMO_STORAGE_PREFIX = "estatetour_promo_cycle_end";

function promoStorageKey(userKey: string | number | undefined) {
  return `${PROMO_STORAGE_PREFIX}:${encodeURIComponent(String(userKey ?? "guest"))}`;
}

function readOrAdvancePromoEnd(
  userKey: string | number | undefined,
  now: number
): number {
  const key = promoStorageKey(userKey);
  let end = Number.NaN;
  try {
    end = Number(localStorage.getItem(key));
  } catch {
    // A stable in-memory end is maintained by the hook when storage is blocked.
  }
  if (!Number.isFinite(end) || end <= 0) {
    end = now + PROMO_CYCLE_MS;
  } else if (end <= now) {
    end += (Math.floor((now - end) / PROMO_CYCLE_MS) + 1) * PROMO_CYCLE_MS;
  }
  try {
    localStorage.setItem(key, String(end));
  } catch {
    // The countdown remains presentation-only when browser storage is blocked.
  }
  return end;
}

function useCountdown(userKey: string | number | undefined) {
  const [remaining, setRemaining] = useState(PROMO_CYCLE_MS);
  useEffect(() => {
    let end = readOrAdvancePromoEnd(userKey, Date.now());
    const tick = () => {
      const now = Date.now();
      if (end <= now) {
        end +=
          (Math.floor((now - end) / PROMO_CYCLE_MS) + 1) * PROMO_CYCLE_MS;
        try {
          localStorage.setItem(promoStorageKey(userKey), String(end));
        } catch {
          // Continue the in-memory cycle if persistence is unavailable.
        }
      }
      setRemaining(Math.max(0, end - now));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [userKey]);

  const seconds = Math.floor(remaining / 1000);
  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
  };
}

function TimeBlock({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex min-w-12 flex-col items-center rounded-xl border border-white/10 bg-white/10 px-2.5 py-1.5 backdrop-blur-sm">
      <strong className="font-display text-sm tabular-nums text-white">
        {String(value).padStart(2, "0")}
      </strong>
      <span className="text-[9px] uppercase tracking-[0.15em] text-white/55">
        {label}
      </span>
    </span>
  );
}

interface PricingCardsProps {
  onSelectPlan: (planId: PlanId) => Promise<void> | void;
  loadingPlan?: PlanId | null;
  compact?: boolean;
  className?: string;
  promoUserKey?: string | number;
}

export default function PricingCards({
  onSelectPlan,
  loadingPlan = null,
  compact = false,
  className,
  promoUserKey = "guest",
}: PricingCardsProps) {
  const [interval, setInterval] = useState<BillingInterval>("year");
  const countdown = useCountdown(promoUserKey);
  const plans = useMemo(() => plansForInterval(interval), [interval]);

  return (
    <div className={className}>
      <div className="relative mx-auto mb-7 flex max-w-3xl flex-col items-center justify-between gap-4 overflow-hidden rounded-2xl bg-zinc-950 px-5 py-4 text-white shadow-2xl shadow-zinc-950/20 sm:flex-row">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(255,255,255,.14),transparent_36%)]" />
        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-zinc-950">
            <Sparkles className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">
              Launch offer · {PROMOTIONAL_DISCOUNT_PERCENT}% off
            </p>
            <p className="text-xs text-white/55">
              Your personal offer renews automatically every {PROMOTIONAL_CYCLE_HOURS} hours.
            </p>
          </div>
        </div>
        <div
          className="relative flex items-center gap-2"
          aria-label="Promotional offer countdown"
        >
          <Clock3 className="mr-1 h-4 w-4 text-white/55" />
          <TimeBlock value={countdown.days} label="days" />
          <TimeBlock value={countdown.hours} label="hrs" />
          <TimeBlock value={countdown.minutes} label="min" />
          <TimeBlock value={countdown.seconds} label="sec" />
        </div>
      </div>

      <div className="mb-8 flex justify-center">
        <div className="inline-flex rounded-full border border-zinc-200 bg-white/80 p-1 shadow-sm backdrop-blur-xl">
          {(["month", "year"] as const).map(value => (
            <button
              key={value}
              type="button"
              onClick={() => setInterval(value)}
              className={cn(
                "relative rounded-full px-5 py-2 text-sm font-semibold transition-all duration-300",
                interval === value
                  ? "bg-zinc-950 text-white shadow-lg"
                  : "text-zinc-500 hover:text-zinc-950"
              )}
            >
              {value === "month" ? "Monthly" : "Yearly"}
              {value === "year" && (
                <span className="absolute -right-5 -top-3 rounded-full bg-zinc-950 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                  Annual rates
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className={cn("grid gap-5 lg:grid-cols-3", compact && "gap-4")}>
        {plans.map((plan, index) => {
          const monthlyEquivalent =
            plan.interval === "year" ? plan.price / 12 : plan.price;
          const originalMonthlyEquivalent =
            plan.interval === "year"
              ? plan.originalPrice / 12
              : plan.originalPrice;
          return (
            <article
              key={plan.id}
              className={cn(
                "pricing-card-enter group relative flex flex-col overflow-hidden rounded-3xl border bg-white/85 p-6 shadow-[0_18px_60px_-32px_rgba(24,24,27,.35)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-2 hover:shadow-[0_28px_70px_-30px_rgba(24,24,27,.38)]",
                plan.highlighted
                  ? "border-zinc-950 ring-1 ring-zinc-950"
                  : "border-zinc-200/80",
                compact && "p-5"
              )}
              style={{ animationDelay: `${index * 100}ms` }}
            >
              {plan.badge && (
                <span className="absolute right-4 top-4 rounded-full bg-zinc-950 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white">
                  {plan.badge}
                </span>
              )}
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
                  {plan.interval === "year" ? "Annual plan" : "Monthly plan"}
                </p>
                <h3 className="mt-2 font-display text-2xl text-zinc-950">
                  {plan.name}
                </h3>
                <p className="mt-1 min-h-10 text-sm leading-5 text-zinc-500">
                  {plan.tagline}
                </p>
              </div>

              <div className="mt-6">
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <span className="line-through">
                    ${Math.round(originalMonthlyEquivalent)}/mo
                  </span>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-950">
                    -{PROMOTIONAL_DISCOUNT_PERCENT}%
                  </span>
                </div>
                <div className="mt-1 flex items-end gap-1">
                  <span className="font-display text-4xl tracking-tight text-zinc-950">
                    ${Math.round(monthlyEquivalent)}
                  </span>
                  <span className="pb-1.5 text-sm text-zinc-500">/month</span>
                </div>
                {plan.interval === "year" && (
                  <p className="mt-1 text-xs text-zinc-400">
                    ${plan.price} billed once yearly
                  </p>
                )}
              </div>

              <div className="my-6 h-px bg-zinc-100" />
              <ul className="flex-1 space-y-3">
                {plan.features.map(feature => (
                  <li
                    key={feature}
                    className="flex items-start gap-2.5 text-sm text-zinc-600"
                  >
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-100">
                      <Check
                        className="h-3 w-3 text-zinc-900"
                        strokeWidth={2.5}
                      />
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>

              <Button
                type="button"
                onClick={() => onSelectPlan(plan.id)}
                disabled={loadingPlan !== null}
                className={cn(
                  "btn-springy mt-7 h-11 w-full rounded-full border-0 font-semibold",
                  plan.highlighted
                    ? "bg-zinc-950 text-white hover:bg-zinc-800"
                    : "bg-zinc-200 text-zinc-950 hover:bg-zinc-300"
                )}
              >
                {loadingPlan === plan.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  `Choose ${plan.name}`
                )}
              </Button>
            </article>
          );
        })}
      </div>
    </div>
  );
}
