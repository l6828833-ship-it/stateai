import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { authenticatedFetch } from "@/lib/authenticatedFetch";
import { planForStoredId } from "@shared/plans";
import {
  CalendarClock,
  CreditCard,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

type BillingSummary = {
  plan: string | null;
  status: string;
  source: "stripe" | "admin";
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canManageInStripe: boolean;
};

interface BillingManagementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPlan?: string | null;
  onChangePlan: () => void;
  onOpenStripePortal: () => Promise<void> | void;
}

function formatPeriodEnd(value: string | null | undefined) {
  if (!value) return "Not available";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function BillingManagementModal({
  open,
  onOpenChange,
  currentPlan,
  onChangePlan,
  onOpenStripePortal,
}: BillingManagementModalProps) {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<"cancel" | "resume" | "portal" | null>(
    null
  );

  const loadBilling = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authenticatedFetch("/api/billing/status");
      const data = (await response.json()) as BillingSummary & {
        error?: string;
      };
      if (!response.ok) throw new Error(data.error || "Could not load billing");
      setSummary(data);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load billing"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadBilling();
  }, [loadBilling, open]);

  const updateCancellation = async (nextAction: "cancel" | "resume") => {
    if (
      nextAction === "cancel" &&
      !window.confirm(
        "Cancel at the end of your current billing period? You will keep access until then."
      )
    ) {
      return;
    }
    setAction(nextAction);
    try {
      const response = await authenticatedFetch(`/api/billing/${nextAction}`, {
        method: "POST",
      });
      const data = (await response.json()) as BillingSummary & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Could not update the subscription");
      }
      setSummary(data);
      toast.success(
        nextAction === "cancel"
          ? "Subscription will cancel at the end of the billing period"
          : "Your subscription will continue"
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update the subscription"
      );
    } finally {
      setAction(null);
    }
  };

  const catalogPlan = planForStoredId(summary?.plan ?? currentPlan);
  const planName = catalogPlan
    ? `${catalogPlan.name} ${catalogPlan.interval === "year" ? "Yearly" : "Monthly"}`
    : "Active plan";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,36rem)] !max-w-none rounded-3xl border-zinc-200 bg-white p-0">
        <div className="border-b border-zinc-100 bg-zinc-50 p-6 sm:p-7">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-950 text-white">
            <CreditCard className="h-5 w-5" />
          </span>
          <DialogTitle className="mt-4 font-display text-2xl text-zinc-950">
            Manage billing
          </DialogTitle>
          <p className="mt-1 text-sm text-zinc-500">
            Change your plan, update payment details, or manage cancellation.
          </p>
        </div>

        <div className="space-y-4 p-6 sm:p-7">
          {loading && !summary ? (
            <div className="flex min-h-36 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-zinc-200 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">
                      Current subscription
                    </p>
                    <p className="mt-1 font-display text-xl text-zinc-950">
                      {planName}
                    </p>
                  </div>
                  <span className="rounded-full bg-zinc-950 px-2.5 py-1 text-[11px] font-semibold capitalize text-white">
                    {summary?.status || "active"}
                  </span>
                </div>
                <div className="mt-4 flex items-center gap-2 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
                  <CalendarClock className="h-4 w-4" />
                  {summary?.cancelAtPeriodEnd
                    ? `Access ends ${formatPeriodEnd(summary.currentPeriodEnd)}`
                    : `Current period ends ${formatPeriodEnd(summary?.currentPeriodEnd)}`}
                </div>
                {summary?.source === "admin" && (
                  <p className="mt-3 rounded-xl bg-zinc-100 p-3 text-xs leading-5 text-zinc-600">
                    This plan was granted by an administrator and is not charged
                    through Stripe. You can still choose a paid plan below.
                  </p>
                )}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  className="justify-start rounded-xl"
                  onClick={() => {
                    onOpenChange(false);
                    onChangePlan();
                  }}
                >
                  <Sparkles className="mr-2 h-4 w-4" /> Change or upgrade plan
                </Button>
                {summary?.canManageInStripe && (
                  <Button
                    variant="outline"
                    className="justify-start rounded-xl"
                    disabled={action !== null}
                    onClick={async () => {
                      setAction("portal");
                      try {
                        await onOpenStripePortal();
                      } finally {
                        setAction(null);
                      }
                    }}
                  >
                    {action === "portal" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="mr-2 h-4 w-4" />
                    )}
                    Payment & invoices
                  </Button>
                )}
              </div>

              {summary?.source === "stripe" && (
                <div className="rounded-2xl border border-zinc-200 p-4">
                  <p className="text-sm font-medium text-zinc-950">
                    Subscription cancellation
                  </p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    Cancellation takes effect after the period you already paid
                    for. Your videos remain available until then.
                  </p>
                  {summary.cancelAtPeriodEnd ? (
                    <Button
                      variant="outline"
                      className="mt-3 rounded-xl"
                      disabled={action !== null}
                      onClick={() => void updateCancellation("resume")}
                    >
                      {action === "resume" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      )}
                      Keep my subscription
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      className="mt-3 rounded-xl text-red-600 hover:text-red-700"
                      disabled={action !== null}
                      onClick={() => void updateCancellation("cancel")}
                    >
                      {action === "cancel" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <XCircle className="mr-2 h-4 w-4" />
                      )}
                      Cancel subscription
                    </Button>
                  )}
                </div>
              )}

              {!summary && (
                <Button
                  variant="outline"
                  className="w-full rounded-xl"
                  onClick={() => void loadBilling()}
                >
                  <RefreshCw className="mr-2 h-4 w-4" /> Try again
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
