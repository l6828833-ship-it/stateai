import { useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  BarChart3,
  Clapperboard,
  CreditCard,
  Crown,
  Film,
  History,
  Home,
  LogOut,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DashboardSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  currentPlan?: string | null;
  subscribed?: boolean;
  activeSection?: string;
  onNavigate?: (section: string) => void;
  onUpgradeClick?: () => void;
  onBuyAdditionalVideo?: () => void;
  onBillingClick?: () => void;
}

export default function DashboardSidebar({
  isOpen = true,
  onClose,
  currentPlan,
  subscribed,
  activeSection = "create",
  onNavigate,
  onUpgradeClick,
  onBuyAdditionalVideo,
  onBillingClick,
}: DashboardSidebarProps) {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const jobsQuery = trpc.tour.listJobs.useQuery();

  const stats = useMemo(() => {
    const jobs = jobsQuery.data ?? [];
    const readyCount = jobs.filter(j => j.status === "ready").length;
    const processingCount = jobs.filter(j => j.status === "processing").length;
    return { readyCount, processingCount, totalJobs: jobs.length };
  }, [jobsQuery.data]);

  const navItems = [
    { icon: Home, label: "Dashboard", id: "dashboard", section: "create" },
    { icon: Film, label: "Create Tour", id: "create", section: "create" },
    { icon: History, label: "My Videos", id: "videos", section: "videos" },
    {
      icon: BarChart3,
      label: "Analytics",
      id: "analytics",
      section: "analytics",
    },
  ];

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  const planLabel = subscribed
    ? currentPlan
      ? currentPlan
          .replaceAll("_", " ")
          .replace(/\b\w/g, letter => letter.toUpperCase()) + " Plan"
      : "Active Plan"
    : "Free Account";

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-foreground/20 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-white/10 bg-zinc-950 text-white shadow-2xl shadow-black/15 transition-transform duration-300 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Decorative glow */}
        <div
          className="pointer-events-none absolute -top-10 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full opacity-40 blur-3xl"
          style={{
            background: "radial-gradient(circle, rgba(255,255,255,.18) 0%, transparent 70%)",
          }}
        />

        {/* Header */}
        <div className="relative flex h-16 items-center justify-between px-5">
          <a
            href="/"
            className="flex items-center gap-2 font-display text-lg text-white"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-zinc-950 shadow-sm">
              <Clapperboard className="h-4 w-4" />
            </span>
            EstateTour
          </a>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
          >
            <span className="sr-only">Close sidebar</span>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative flex-1 overflow-y-auto px-4 pb-4">
          {/* User Profile */}
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-sm font-semibold text-zinc-950">
              {user?.name?.charAt(0).toUpperCase() ?? "U"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">
                {user?.name ?? "User"}
              </p>
              <p className="truncate text-xs text-white/50">
                {user?.email}
              </p>
            </div>
          </div>

          {/* Navigation */}
          <p className="mb-2 mt-6 px-2 text-[11px] font-semibold uppercase tracking-wider text-white/50">
            Menu
          </p>
          <nav className="space-y-1">
            {navItems.map(item => {
              const active = item.id === activeSection;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onNavigate?.(item.section);
                    onClose?.();
                  }}
                  className={cn(
                    "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                    active
                      ? "bg-white text-zinc-950 shadow-sm"
                      : "text-white/55 hover:bg-white/10 hover:text-white"
                  )}
                >
                  <item.icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-transform group-hover:scale-110",
                      active && "text-zinc-950"
                    )}
                  />
                  <span>{item.label}</span>
                  {active && (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-zinc-950" />
                  )}
                </button>
              );
            })}
            {user?.role === "admin" && (
              <button
                onClick={() => navigate("/admin")}
                className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/55 transition-all hover:bg-white/10 hover:text-white"
              >
                <ShieldCheck className="h-4 w-4 shrink-0 transition-transform group-hover:scale-110" />
                <span>Admin Console</span>
                <span className="ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-bold uppercase text-white/70 group-hover:bg-white group-hover:text-zinc-950">
                  Admin
                </span>
              </button>
            )}
          </nav>

          {/* Quick Stats */}
          <p className="mb-2 mt-6 px-2 text-[11px] font-semibold uppercase tracking-wider text-white/50">
            Quick stats
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Ready", value: stats.readyCount, icon: Film },
              {
                label: "Rendering",
                value: stats.processingCount,
                icon: Sparkles,
              },
              { label: "Total", value: stats.totalJobs, icon: BarChart3 },
            ].map(s => (
              <div
                key={s.label}
                className="flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2 py-3 text-center"
              >
                <s.icon className="h-3.5 w-3.5 text-white/60" />
                <span className="text-lg font-semibold leading-none text-white">
                  {s.value}
                </span>
                <span className="text-[10px] text-white/50">
                  {s.label}
                </span>
              </div>
            ))}
          </div>

          {/* Subscription / Upgrade card */}
          <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-1 flex items-center gap-2">
              {subscribed ? (
                <Crown className="h-4 w-4 text-white/65" />
              ) : (
                <Zap className="h-4 w-4 text-white/65" />
              )}
              <p className="text-sm font-semibold text-white">
                {planLabel}
              </p>
            </div>
            <p className="mb-3 text-xs text-white/50">
              {subscribed
                ? "Cinematic 1080p generations without watermarks."
                : "Upgrade for cinematic 1080p tours without watermarks."}
            </p>
            {subscribed ? (
              <div className="space-y-2">
                <Button
                  size="sm"
                  className="btn-springy w-full rounded-full bg-white text-zinc-950 hover:bg-zinc-200"
                  onClick={onBuyAdditionalVideo}
                >
                  <Zap className="mr-1.5 h-3.5 w-3.5" /> Add video · $17
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="btn-springy w-full rounded-full border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                  onClick={onBillingClick}
                >
                  <CreditCard className="mr-1.5 h-3.5 w-3.5" /> Manage billing
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                className="btn-springy w-full rounded-full bg-white text-zinc-950 hover:bg-zinc-200"
                onClick={onUpgradeClick}
              >
                <Crown className="mr-1.5 h-3.5 w-3.5" /> Upgrade plan
              </Button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="relative border-t border-white/10 p-4">
          <Button
            variant="ghost"
            size="sm"
            className="btn-springy w-full justify-start text-white/55 hover:bg-white/10 hover:text-white"
            onClick={handleLogout}
          >
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>
    </>
  );
}
