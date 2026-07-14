import { useMemo } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  BarChart3,
  Clapperboard,
  CreditCard,
  Film,
  Home,
  LogOut,
  Settings,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface DashboardSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
  currentPlan?: string | null;
  subscribed?: boolean;
}

export default function DashboardSidebar({
  isOpen = true,
  onClose,
  currentPlan,
  subscribed,
}: DashboardSidebarProps) {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const stateQuery = trpc.tour.getState.useQuery();
  const jobsQuery = trpc.tour.listJobs.useQuery();

  const stats = useMemo(() => {
    const jobs = jobsQuery.data ?? [];
    const readyCount = jobs.filter((j) => j.status === "ready").length;
    const processingCount = jobs.filter((j) => j.status === "processing").length;
    return { readyCount, processingCount, totalJobs: jobs.length };
  }, [jobsQuery.data]);

  const navItems = [
    { icon: Home, label: "Dashboard", href: "/dashboard" },
    { icon: Film, label: "Create Tour", href: "#tour-tool" },
    { icon: BarChart3, label: "Analytics", href: "#" },
  ];

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  const handleNavClick = (href: string) => {
    if (href.startsWith("#")) {
      document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth" });
    } else {
      navigate(href);
    }
    onClose?.();
  };

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/20 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-72 overflow-y-auto border-r border-border/50 bg-card/95 backdrop-blur-sm transition-transform duration-300 lg:sticky lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="sticky top-0 border-b border-border/50 bg-card/95 p-5">
            <div className="flex items-center justify-between">
              <a href="/" className="flex items-center gap-2 font-display text-lg text-foreground">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <Clapperboard className="h-4 w-4" />
                </span>
                <span className="hidden sm:inline">EstateTour</span>
              </a>
              <button
                onClick={onClose}
                className="lg:hidden p-1 hover:bg-muted rounded-lg transition-colors"
              >
                <span className="sr-only">Close sidebar</span>
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* User Profile Card */}
          <div className="p-5 border-b border-border/50">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground font-semibold text-sm">
                {user?.name?.charAt(0).toUpperCase() ?? "U"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">
                  {user?.name ?? "User"}
                </p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </div>
            </div>
          </div>

          {/* Subscription Status */}
          <div className="p-5 border-b border-border/50">
            <div
              className={cn(
                "rounded-xl p-4",
                subscribed
                  ? "bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20"
                  : "bg-muted/50 border border-border/50",
              )}
            >
              <div className="flex items-center gap-2 mb-2">
                <Zap className={cn("h-4 w-4", subscribed ? "text-primary" : "text-muted-foreground")} />
                <p className="text-xs font-semibold text-foreground">
                  {subscribed ? currentPlan ? currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1) + " Plan" : "Active Plan" : "Free Account"}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {subscribed
                  ? "Unlimited generations"
                  : "Limited to 1 tour/week"}
              </p>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="p-5 border-b border-border/50">
            <p className="text-xs font-semibold text-muted-foreground mb-3">QUICK STATS</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                <span className="text-xs text-muted-foreground">Videos Ready</span>
                <span className="text-sm font-semibold text-foreground">{stats.readyCount}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                <span className="text-xs text-muted-foreground">Processing</span>
                <span className="text-sm font-semibold text-foreground">{stats.processingCount}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
                <span className="text-xs text-muted-foreground">Total Generated</span>
                <span className="text-sm font-semibold text-foreground">{stats.totalJobs}</span>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-5 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground mb-3">NAVIGATION</p>
            {navItems.map((item) => (
              <button
                key={item.label}
                onClick={() => handleNavClick(item.href)}
                className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          {/* Footer Actions */}
          <div className="border-t border-border/50 p-5 space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                navigate("/dashboard");
                onClose?.();
              }}
            >
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                window.location.href = "/api/billing/portal";
              }}
            >
              <CreditCard className="mr-2 h-4 w-4" />
              Billing
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={handleLogout}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}
