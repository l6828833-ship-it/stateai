import { useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  BarChart3,
  CreditCard,
  Crown,
  Film,
  History,
  Home,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import Logo from "@/components/Logo";
import { cn } from "@/lib/utils";
import { planForStoredId } from "@shared/plans";

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
  additionalVideoPriceUsd?: number;
  desktopCollapsed?: boolean;
  onToggleDesktop?: () => void;
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
  additionalVideoPriceUsd,
  desktopCollapsed = false,
  onToggleDesktop,
}: DashboardSidebarProps) {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const jobsQuery = trpc.tour.listJobs.useQuery();

  const stats = useMemo(() => {
    const jobs = jobsQuery.data ?? [];
    const unavailable = !jobsQuery.data && !jobsQuery.isSuccess;
    const readyCount = jobs.filter(j => j.status === "ready").length;
    const processingCount = jobs.filter(j => j.status === "processing").length;
    return {
      readyCount: unavailable ? "—" : readyCount,
      processingCount: unavailable ? "—" : processingCount,
      totalJobs: unavailable ? "—" : jobs.length,
    };
  }, [jobsQuery.data, jobsQuery.isSuccess]);

  const navItems = [
    { icon: Home, label: "Dashboard", id: "overview", section: "overview" },
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

  const catalogPlan = planForStoredId(currentPlan);
  const planLabel = subscribed
    ? catalogPlan
      ? `${catalogPlan.name} ${catalogPlan.interval === "year" ? "Yearly" : "Monthly"} Plan`
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
          "fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col overflow-x-hidden border-r border-white/10 bg-zinc-950 text-white shadow-2xl shadow-black/15 transition-[width,transform] duration-300 lg:sticky lg:inset-y-auto lg:top-0 lg:h-dvh lg:self-start lg:translate-x-0",
          desktopCollapsed ? "lg:w-20" : "lg:w-72",
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Decorative glow */}
        <div
          className="pointer-events-none absolute -top-10 left-1/2 h-40 w-40 -translate-x-1/2 rounded-full opacity-40 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, rgba(255,255,255,.18) 0%, transparent 70%)",
          }}
        />

        {/* Header */}
        <div
          className={cn(
            "relative flex h-16 shrink-0 items-center px-5",
            desktopCollapsed ? "justify-between lg:px-1" : "justify-between"
          )}
        >
          <a
            href="/"
            className="flex items-center gap-2 font-display text-lg text-white"
            title="EstateTour home"
          >
            <Logo className="h-9 w-9 ring-white/15" />
            <span className={cn(desktopCollapsed && "lg:hidden")}>
              EstateTour
            </span>
          </a>
          <button
            type="button"
            onClick={onToggleDesktop}
            className="hidden rounded-lg p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white lg:inline-flex"
            aria-label={
              desktopCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
            title={desktopCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {desktopCollapsed ? (
              <PanelLeftOpen className="h-5 w-5" />
            ) : (
              <PanelLeftClose className="h-5 w-5" />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
          >
            <span className="sr-only">Close sidebar</span>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          className={cn(
            "relative flex-1 overflow-y-auto pb-4",
            desktopCollapsed ? "px-4 lg:px-2" : "px-4"
          )}
        >
          {/* User Profile */}
          <div
            className={cn(
              "flex items-center rounded-2xl border border-white/10 bg-white/5 p-3",
              desktopCollapsed ? "gap-3 lg:justify-center lg:p-2" : "gap-3"
            )}
            title={desktopCollapsed ? (user?.name ?? "User") : undefined}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-sm font-semibold text-zinc-950">
              {user?.name?.charAt(0).toUpperCase() ?? "U"}
            </div>
            <div
              className={cn("min-w-0 flex-1", desktopCollapsed && "lg:hidden")}
            >
              <p className="truncate text-sm font-medium text-white">
                {user?.name ?? "User"}
              </p>
              <p className="truncate text-xs text-white/50">{user?.email}</p>
            </div>
          </div>

          {/* Navigation */}
          <p
            className={cn(
              "mb-2 mt-6 px-2 text-[11px] font-semibold uppercase tracking-wider text-white/50",
              desktopCollapsed && "lg:hidden"
            )}
          >
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
                  aria-current={active ? "page" : undefined}
                  aria-label={item.label}
                  title={desktopCollapsed ? item.label : undefined}
                  className={cn(
                    "group flex w-full items-center rounded-xl px-3 py-2.5 text-sm font-medium transition-all",
                    desktopCollapsed
                      ? "gap-3 lg:justify-center lg:px-2"
                      : "gap-3",
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
                  <span className={cn(desktopCollapsed && "lg:hidden")}>
                    {item.label}
                  </span>
                  {active && (
                    <span
                      className={cn(
                        "ml-auto h-1.5 w-1.5 rounded-full bg-zinc-950",
                        desktopCollapsed && "lg:hidden"
                      )}
                    />
                  )}
                </button>
              );
            })}
            {user?.role === "admin" && (
              <button
                onClick={() => navigate("/admin")}
                aria-label="Admin Console"
                title={desktopCollapsed ? "Admin Console" : undefined}
                className={cn(
                  "group flex w-full items-center rounded-xl px-3 py-2.5 text-sm font-medium text-white/55 transition-all hover:bg-white/10 hover:text-white",
                  desktopCollapsed ? "gap-3 lg:justify-center lg:px-2" : "gap-3"
                )}
              >
                <ShieldCheck className="h-4 w-4 shrink-0 transition-transform group-hover:scale-110" />
                <span className={cn(desktopCollapsed && "lg:hidden")}>
                  Admin Console
                </span>
                <span
                  className={cn(
                    "ml-auto rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-bold uppercase text-white/70 group-hover:bg-white group-hover:text-zinc-950",
                    desktopCollapsed && "lg:hidden"
                  )}
                >
                  Admin
                </span>
              </button>
            )}
          </nav>

          <div className={cn(desktopCollapsed && "lg:hidden")}>
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
                  <span className="text-[10px] text-white/50">{s.label}</span>
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
                <p className="text-sm font-semibold text-white">{planLabel}</p>
              </div>
              <p className="mb-3 text-xs text-white/50">
                {subscribed
                  ? "Cinematic 1080p generations without watermarks."
                  : "Buy one Starter-feature video for $17, or choose a plan."}
              </p>
              {subscribed ? (
                <div className="space-y-2">
                  <Button
                    size="sm"
                    className="btn-springy w-full rounded-full bg-white text-zinc-950 hover:bg-zinc-200"
                    onClick={onBuyAdditionalVideo}
                  >
                    <Zap className="mr-1.5 h-3.5 w-3.5" /> Add video
                    {additionalVideoPriceUsd
                      ? ` · $${additionalVideoPriceUsd}`
                      : ""}
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
                <div className="space-y-2">
                  <Button
                    size="sm"
                    className="btn-springy w-full rounded-full bg-white text-zinc-950 hover:bg-zinc-200"
                    onClick={onBuyAdditionalVideo}
                  >
                    <Zap className="mr-1.5 h-3.5 w-3.5" /> One video · $17
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="btn-springy w-full rounded-full border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
                    onClick={onUpgradeClick}
                  >
                    <Crown className="mr-1.5 h-3.5 w-3.5" /> See plans
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className={cn(
            "relative shrink-0 border-t border-white/10 p-4",
            desktopCollapsed && "lg:px-2"
          )}
        >
          <Button
            variant="ghost"
            size="sm"
            aria-label="Sign out"
            title={desktopCollapsed ? "Sign out" : undefined}
            className={cn(
              "btn-springy w-full text-white/55 hover:bg-white/10 hover:text-white",
              desktopCollapsed
                ? "justify-start lg:justify-center lg:px-2"
                : "justify-start"
            )}
            onClick={handleLogout}
          >
            <LogOut
              className={cn("h-4 w-4", desktopCollapsed ? "lg:mr-0" : "mr-2")}
            />
            <span className={cn(desktopCollapsed && "lg:hidden")}>
              Sign out
            </span>
          </Button>
        </div>
      </aside>
    </>
  );
}
