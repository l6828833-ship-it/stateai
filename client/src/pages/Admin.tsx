import { useDeferredValue, useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity,
  ArrowLeft,
  Ban,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  CreditCard,
  FileClock,
  KeyRound,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  LogOut,
  Menu,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  UserCog,
  Users,
  X,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

type AdminTab = "users" | "audit";

function StatusPill({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
        active ? "bg-zinc-950 text-white" : "bg-zinc-200 text-zinc-700"
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          active ? "bg-white" : "bg-zinc-500"
        )}
      />
      {children}
    </span>
  );
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export default function Admin() {
  const { user, loading, logout } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState<AdminTab>("users");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [role, setRole] = useState<"all" | "user" | "admin">("all");
  const [accountStatus, setAccountStatus] = useState<
    "all" | "active" | "disabled"
  >("all");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(
    null
  );
  const [usageAdjustment, setUsageAdjustment] = useState("0");

  useEffect(() => {
    if (!loading && !user) navigate("/login");
    else if (!loading && user?.forcePasswordChange)
      navigate("/change-password");
    else if (!loading && user?.role !== "admin") navigate("/dashboard");
  }, [loading, navigate, user]);

  useEffect(() => setPage(1), [deferredSearch, role, accountStatus]);

  const usersQuery = trpc.admin.listUsers.useQuery(
    {
      page,
      pageSize: 20,
      search: deferredSearch || undefined,
      role,
      accountStatus,
    },
    { enabled: user?.role === "admin", placeholderData: previous => previous }
  );
  const auditQuery = trpc.admin.listAuditLogs.useQuery(
    { page: auditPage, pageSize: 30 },
    {
      enabled: user?.role === "admin" && tab === "audit",
      placeholderData: previous => previous,
    }
  );
  const detailQuery = trpc.admin.getUser.useQuery(
    { userId: selectedUserId ?? 0 },
    { enabled: selectedUserId !== null }
  );
  const plansQuery = trpc.admin.availablePlans.useQuery(undefined, {
    enabled: selectedUserId !== null,
  });

  useEffect(() => {
    if (detailQuery.data)
      setUsageAdjustment(String(detailQuery.data.usageAdjustment ?? 0));
  }, [detailQuery.data]);

  const refreshAdminData = async () => {
    await Promise.all([
      utils.admin.listUsers.invalidate(),
      utils.admin.getUser.invalidate(),
      utils.admin.listAuditLogs.invalidate(),
    ]);
  };

  const accountMutation = trpc.admin.setAccountDisabled.useMutation({
    onSuccess: refreshAdminData,
  });
  const roleMutation = trpc.admin.setRole.useMutation({
    onSuccess: refreshAdminData,
  });
  const resetMutation = trpc.admin.resetPassword.useMutation({
    onSuccess: refreshAdminData,
  });
  const revokeMutation = trpc.admin.revokeSessions.useMutation({
    onSuccess: refreshAdminData,
  });
  const usageMutation = trpc.admin.setUsageAdjustment.useMutation({
    onSuccess: refreshAdminData,
  });
  const planMutation = trpc.admin.changePlan.useMutation({
    onSuccess: refreshAdminData,
  });
  const actionPending =
    accountMutation.isPending ||
    roleMutation.isPending ||
    resetMutation.isPending ||
    revokeMutation.isPending ||
    usageMutation.isPending ||
    planMutation.isPending;

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Admin action failed"
      );
    }
  };

  const openUser = (id: number) => {
    setSelectedUserId(id);
    setTemporaryPassword(null);
  };

  if (loading || (user?.role === "admin" && usersQuery.isLoading)) {
    return (
      <div className="min-h-screen bg-background p-8">
        <Skeleton className="h-[80vh] rounded-3xl" />
      </div>
    );
  }
  if (!user || user.role !== "admin") return null;

  const data = usersQuery.data;
  const selected = detailQuery.data;

  return (
    <div className="flex min-h-screen bg-background text-zinc-950">
      {sidebarOpen && (
        <button
          className="fixed inset-0 z-40 bg-zinc-950/30 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close admin navigation"
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-zinc-950 text-white transition-transform duration-300 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-20 items-center justify-between border-b border-white/10 px-5">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-3 text-left"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-zinc-950">
              <Shield className="h-5 w-5" />
            </span>
            <span>
              <strong className="block font-display">EstateTour</strong>
              <span className="text-[10px] uppercase tracking-[0.18em] text-white/40">
                Admin console
              </span>
            </span>
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-2 text-white/50 hover:bg-white/10 lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav className="flex-1 space-y-2 p-4">
          <button
            onClick={() => {
              setTab("users");
              setSidebarOpen(false);
            }}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium",
              tab === "users"
                ? "bg-white text-zinc-950"
                : "text-white/60 hover:bg-white/10 hover:text-white"
            )}
          >
            <Users className="h-4 w-4" /> User management
          </button>
          <button
            onClick={() => {
              setTab("audit");
              setSidebarOpen(false);
            }}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium",
              tab === "audit"
                ? "bg-white text-zinc-950"
                : "text-white/60 hover:bg-white/10 hover:text-white"
            )}
          >
            <FileClock className="h-4 w-4" /> Audit history
          </button>
          <div className="my-3 h-px bg-white/10" />
          <button
            onClick={() => navigate("/dashboard")}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-white/60 hover:bg-white/10 hover:text-white"
          >
            <LayoutDashboard className="h-4 w-4" /> User dashboard
          </button>
          <button
            onClick={() => navigate("/")}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-white/60 hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> Public website
          </button>
        </nav>
        <div className="border-t border-white/10 p-4">
          <div className="mb-3 rounded-xl bg-white/5 p-3">
            <p className="truncate text-sm font-medium">
              {user.name || "Administrator"}
            </p>
            <p className="truncate text-xs text-white/40">{user.email}</p>
          </div>
          <button
            onClick={async () => {
              await logout();
              navigate("/");
            }}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/50 hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-zinc-200 bg-white/85 px-4 backdrop-blur-xl sm:px-7">
          <div className="flex items-center gap-3">
            <button
              className="rounded-xl border border-zinc-200 p-2 lg:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-4 w-4" />
            </button>
            <div>
              <h1 className="font-display text-lg">
                {tab === "users"
                  ? "User management"
                  : "Immutable audit history"}
              </h1>
              <p className="hidden text-xs text-zinc-400 sm:block">
                Secure operational controls for your SaaS
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-3 py-1 text-xs font-semibold text-white">
            <ShieldCheck className="h-3.5 w-3.5" /> Admin only
          </span>
        </header>

        <main className="p-4 sm:p-7 lg:p-9">
          {tab === "users" ? (
            <>
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  {
                    label: "Total users",
                    value: data?.overview.total ?? 0,
                    icon: Users,
                  },
                  {
                    label: "Active accounts",
                    value: data?.overview.active ?? 0,
                    icon: CheckCircle2,
                  },
                  {
                    label: "Disabled",
                    value: data?.overview.disabled ?? 0,
                    icon: Ban,
                  },
                  {
                    label: "Administrators",
                    value: data?.overview.admins ?? 0,
                    icon: ShieldCheck,
                  },
                ].map(metric => (
                  <div
                    key={metric.label}
                    className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100">
                        <metric.icon className="h-4 w-4" />
                      </span>
                      <strong className="font-display text-3xl">
                        {metric.value}
                      </strong>
                    </div>
                    <p className="mt-3 text-sm text-zinc-500">{metric.label}</p>
                  </div>
                ))}
              </section>

              <section className="mt-6 overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-zinc-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                  <div className="relative min-w-0 flex-1 sm:max-w-md">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                    <Input
                      value={search}
                      onChange={event => setSearch(event.target.value)}
                      placeholder="Search name, email, or account ID…"
                      className="pl-9"
                    />
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={role}
                      onChange={event =>
                        setRole(event.target.value as typeof role)
                      }
                      className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                    >
                      <option value="all">All roles</option>
                      <option value="user">Users</option>
                      <option value="admin">Admins</option>
                    </select>
                    <select
                      value={accountStatus}
                      onChange={event =>
                        setAccountStatus(
                          event.target.value as typeof accountStatus
                        )
                      }
                      className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm"
                    >
                      <option value="all">All accounts</option>
                      <option value="active">Active</option>
                      <option value="disabled">Disabled</option>
                    </select>
                  </div>
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-zinc-50 text-[11px] uppercase tracking-[0.12em] text-zinc-400">
                      <tr>
                        <th className="px-5 py-3 font-semibold">User</th>
                        <th className="px-5 py-3 font-semibold">Role</th>
                        <th className="px-5 py-3 font-semibold">
                          Plan / payment
                        </th>
                        <th className="px-5 py-3 font-semibold">Usage</th>
                        <th className="px-5 py-3 font-semibold">Last active</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {data?.items.map(item => (
                        <tr
                          key={item.id}
                          className="transition-colors hover:bg-zinc-50/80"
                        >
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-950 text-sm font-semibold text-white">
                                {(item.name || item.email || "U")
                                  .charAt(0)
                                  .toUpperCase()}
                              </span>
                              <div className="min-w-0">
                                <p className="max-w-52 truncate font-medium">
                                  {item.name || "Unnamed user"}
                                </p>
                                <p className="max-w-52 truncate text-xs text-zinc-400">
                                  {item.email || item.openId}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium capitalize">
                              {item.role}
                            </span>
                          </td>
                          <td className="px-5 py-4">
                            <p className="font-medium capitalize">
                              {item.plan?.replaceAll("_", " ") || "No plan"}
                            </p>
                            <p className="mt-0.5 text-xs text-zinc-400 capitalize">
                              {item.subscriptionStatus || "No payment"}
                            </p>
                          </td>
                          <td className="px-5 py-4">
                            <p className="font-medium">
                              {item.usageUsed}
                              {item.usageAllowance !== null
                                ? ` / ${item.usageAllowance}`
                                : ""}
                            </p>
                            <p className="text-xs text-zinc-400">
                              {item.totalGenerated} all time
                            </p>
                          </td>
                          <td className="px-5 py-4 text-xs text-zinc-500">
                            {formatDate(item.lastSignedIn)}
                          </td>
                          <td className="px-5 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <StatusPill active={!item.disabledAt}>
                                {item.disabledAt ? "Disabled" : "Active"}
                              </StatusPill>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openUser(item.id)}
                                className="rounded-full"
                              >
                                Manage
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="divide-y divide-zinc-100 md:hidden">
                  {data?.items.map(item => (
                    <button
                      key={item.id}
                      onClick={() => openUser(item.id)}
                      className="flex w-full items-center gap-3 p-4 text-left"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-sm font-semibold text-white">
                        {(item.name || item.email || "U")
                          .charAt(0)
                          .toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <strong className="block truncate text-sm">
                          {item.name || "Unnamed user"}
                        </strong>
                        <span className="block truncate text-xs text-zinc-400">
                          {item.email || item.openId}
                        </span>
                        <span className="mt-1 block text-xs capitalize text-zinc-500">
                          {item.plan?.replaceAll("_", " ") || "No plan"} ·{" "}
                          {item.usageUsed} used
                        </span>
                      </span>
                      <StatusPill active={!item.disabledAt}>
                        {item.disabledAt ? "Off" : "On"}
                      </StatusPill>
                    </button>
                  ))}
                </div>

                {data?.items.length === 0 && (
                  <div className="p-12 text-center">
                    <Users className="mx-auto h-8 w-8 text-zinc-300" />
                    <p className="mt-3 text-sm text-zinc-500">
                      No users match these filters.
                    </p>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-3 text-xs text-zinc-500 sm:px-5">
                  <span>{data?.pagination.total ?? 0} users</span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page <= 1}
                      onClick={() => setPage(value => value - 1)}
                      className="h-8 w-8 rounded-full p-0"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span>
                      Page {page} of {data?.pagination.pageCount ?? 1}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page >= (data?.pagination.pageCount ?? 1)}
                      onClick={() => setPage(value => value + 1)}
                      className="h-8 w-8 rounded-full p-0"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <section className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-zinc-100 p-5">
                <div>
                  <h2 className="font-display text-lg">
                    Administrator activity
                  </h2>
                  <p className="mt-1 text-xs text-zinc-400">
                    Database-protected append-only records. Updates and deletion
                    are rejected.
                  </p>
                </div>
                <span className="rounded-full bg-zinc-950 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                  Immutable
                </span>
              </div>
              <div className="divide-y divide-zinc-100">
                {auditQuery.isLoading ? (
                  <div className="p-8">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </div>
                ) : (
                  auditQuery.data?.items.map(log => (
                    <article
                      key={log.id}
                      className="grid gap-3 p-5 sm:grid-cols-[2fr_1fr_auto]"
                    >
                      <div className="flex gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-100">
                          <Activity className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-sm font-semibold">
                            {log.action.replaceAll(".", " ")}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            By{" "}
                            {log.actor?.name ||
                              log.actor?.email ||
                              `User #${log.actorUserId}`}
                            {log.targetUserId
                              ? ` · Target ${log.target?.name || log.target?.email || `#${log.targetUserId}`}`
                              : ""}
                          </p>
                          <code className="mt-2 block max-w-2xl overflow-x-auto rounded-lg bg-zinc-50 p-2 text-[10px] text-zinc-500">
                            {log.details}
                          </code>
                        </div>
                      </div>
                      <div className="text-xs text-zinc-400">
                        <p>{log.ipAddress || "IP unavailable"}</p>
                        <p className="mt-1 truncate">
                          {log.userAgent || "Agent unavailable"}
                        </p>
                      </div>
                      <time className="text-xs text-zinc-400">
                        {formatDate(log.createdAt)}
                      </time>
                    </article>
                  ))
                )}
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-zinc-100 p-4 text-xs text-zinc-500">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={auditPage <= 1}
                  onClick={() => setAuditPage(value => value - 1)}
                  className="h-8 w-8 rounded-full p-0"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span>
                  Page {auditPage} of{" "}
                  {auditQuery.data?.pagination.pageCount ?? 1}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    auditPage >= (auditQuery.data?.pagination.pageCount ?? 1)
                  }
                  onClick={() => setAuditPage(value => value + 1)}
                  className="h-8 w-8 rounded-full p-0"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </section>
          )}
        </main>
      </div>

      <Dialog
        open={selectedUserId !== null}
        onOpenChange={open => {
          if (!open) setSelectedUserId(null);
        }}
      >
        <DialogContent className="max-h-[94vh] w-[min(96vw,56rem)] !max-w-none overflow-y-auto rounded-3xl border-zinc-200 bg-white p-0">
          <DialogTitle className="sr-only">Manage user</DialogTitle>
          {detailQuery.isLoading || !selected ? (
            <div className="flex min-h-80 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div>
              <div className="border-b border-zinc-100 bg-zinc-50 p-6 sm:p-7">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-950 text-xl font-bold text-white">
                      {(selected.name || selected.email || "U")
                        .charAt(0)
                        .toUpperCase()}
                    </span>
                    <div>
                      <h2 className="font-display text-xl">
                        {selected.name || "Unnamed user"}
                      </h2>
                      <p className="mt-1 text-sm text-zinc-500">
                        {selected.email || selected.openId}
                      </p>
                      <div className="mt-2 flex gap-2">
                        <StatusPill active={!selected.disabledAt}>
                          {selected.disabledAt ? "Disabled" : "Active"}
                        </StatusPill>
                        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold capitalize shadow-sm">
                          {selected.role}
                        </span>
                        {selected.forcePasswordChange && (
                          <span className="rounded-full bg-zinc-200 px-2.5 py-1 text-[11px] font-semibold text-zinc-700">
                            Password change required
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-400">
                    User #{selected.id}
                    <br />
                    Joined {formatDate(selected.createdAt)}
                  </p>
                </div>
              </div>

              <div className="grid gap-6 p-6 sm:p-7 lg:grid-cols-2">
                <section className="space-y-4">
                  <h3 className="flex items-center gap-2 font-display">
                    <CreditCard className="h-4 w-4" /> Subscription & usage
                  </h3>
                  <div className="rounded-2xl border border-zinc-200 p-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-xs text-zinc-400">Plan</p>
                        <p className="mt-1 font-medium capitalize">
                          {selected.plan?.replaceAll("_", " ") || "No plan"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-400">Payment</p>
                        <p className="mt-1 font-medium capitalize">
                          {selected.subscriptionStatus || "No payment"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-400">Current usage</p>
                        <p className="mt-1 font-medium">
                          {selected.usageUsed}
                          {selected.usageAllowance !== null
                            ? ` / ${selected.usageAllowance}`
                            : ""}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-400">All-time videos</p>
                        <p className="mt-1 font-medium">
                          {selected.totalGenerated}
                        </p>
                      </div>
                    </div>
                    <p className="mt-4 border-t border-zinc-100 pt-3 text-xs text-zinc-400">
                      Period ends {formatDate(selected.currentPeriodEnd)}
                    </p>
                  </div>
                  <label className="block text-xs font-medium text-zinc-500">
                    Stripe-backed plan change
                    <select
                      disabled={!selected.stripeSubscriptionId || actionPending}
                      defaultValue={selected.plan || ""}
                      onChange={event => {
                        const planId = event.target.value;
                        if (
                          !planId ||
                          !window.confirm(
                            "Change this live Stripe subscription? Proration may apply."
                          )
                        )
                          return;
                        void runAction(
                          () =>
                            planMutation.mutateAsync({
                              userId: selected.id,
                              planId,
                            }),
                          "Stripe subscription updated"
                        );
                      }}
                      className="mt-1.5 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm disabled:bg-zinc-50"
                    >
                      <option value="">
                        {selected.stripeSubscriptionId
                          ? "Choose a plan"
                          : "No Stripe subscription"}
                      </option>
                      {plansQuery.data?.map(plan => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name} · {plan.interval} · {plan.priceLabel}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      min={-1000}
                      max={10000}
                      value={usageAdjustment}
                      onChange={event => setUsageAdjustment(event.target.value)}
                    />
                    <Button
                      variant="outline"
                      disabled={actionPending || !selected.stripeSubscriptionId}
                      onClick={() =>
                        void runAction(
                          () =>
                            usageMutation.mutateAsync({
                              userId: selected.id,
                              adjustment: Number(usageAdjustment),
                            }),
                          "Usage adjustment saved"
                        )
                      }
                      className="shrink-0 rounded-xl"
                    >
                      Save adjustment
                    </Button>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Adds or removes included generations for the current billing
                    period.
                  </p>
                </section>

                <section className="space-y-4">
                  <h3 className="flex items-center gap-2 font-display">
                    <UserCog className="h-4 w-4" /> Security & access
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      variant="outline"
                      disabled={actionPending || selected.id === user.id}
                      onClick={() =>
                        void runAction(
                          () =>
                            accountMutation.mutateAsync({
                              userId: selected.id,
                              disabled: !selected.disabledAt,
                            }),
                          selected.disabledAt
                            ? "Account enabled"
                            : "Account disabled"
                        )
                      }
                      className="justify-start rounded-xl"
                    >
                      {selected.disabledAt ? (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      ) : (
                        <Ban className="mr-2 h-4 w-4" />
                      )}
                      {selected.disabledAt
                        ? "Enable account"
                        : "Disable account"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={actionPending || selected.id === user.id}
                      onClick={() =>
                        void runAction(
                          () =>
                            roleMutation.mutateAsync({
                              userId: selected.id,
                              role:
                                selected.role === "admin" ? "user" : "admin",
                            }),
                          "User role updated"
                        )
                      }
                      className="justify-start rounded-xl"
                    >
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      {selected.role === "admin" ? "Make user" : "Make admin"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={actionPending || selected.id === user.id}
                      onClick={() =>
                        void runAction(async () => {
                          const result = await resetMutation.mutateAsync({
                            userId: selected.id,
                          });
                          setTemporaryPassword(result.temporaryPassword);
                        }, "Temporary password created")
                      }
                      className="justify-start rounded-xl"
                    >
                      <KeyRound className="mr-2 h-4 w-4" /> Reset password
                    </Button>
                    <Button
                      variant="outline"
                      disabled={actionPending || selected.id === user.id}
                      onClick={() => {
                        if (
                          window.confirm("Sign this user out on every device?")
                        )
                          void runAction(
                            () =>
                              revokeMutation.mutateAsync({
                                userId: selected.id,
                              }),
                            "All sessions revoked"
                          );
                      }}
                      className="justify-start rounded-xl"
                    >
                      <LockKeyhole className="mr-2 h-4 w-4" /> Sign out
                      everywhere
                    </Button>
                  </div>
                  {selected.id === user.id && (
                    <p className="rounded-xl border border-zinc-200 bg-zinc-100 p-3 text-xs leading-5 text-zinc-700">
                      Self-lockout protection is active. You cannot disable,
                      demote, reset, or revoke your own administrator account
                      here.
                    </p>
                  )}
                  {temporaryPassword && (
                    <div className="rounded-2xl border border-zinc-950 bg-zinc-950 p-4 text-white">
                      <p className="text-xs font-semibold uppercase tracking-wider text-white/50">
                        One-time temporary password
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-white/10 p-2 text-sm">
                          {temporaryPassword}
                        </code>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={async () => {
                            await navigator.clipboard.writeText(
                              temporaryPassword
                            );
                            toast.success("Password copied");
                          }}
                          className="rounded-lg"
                        >
                          <Clipboard className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <p className="mt-2 text-[11px] text-white/50">
                        Share securely. The user must replace it after signing
                        in, and old sessions are revoked.
                      </p>
                    </div>
                  )}
                </section>

                <section className="lg:col-span-2">
                  <h3 className="flex items-center gap-2 font-display">
                    <Sparkles className="h-4 w-4" /> Recent generation activity
                  </h3>
                  <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-200">
                    <div className="grid grid-cols-4 bg-zinc-50 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                      <span>Job</span>
                      <span>Status</span>
                      <span>Format</span>
                      <span>Created</span>
                    </div>
                    {selected.recentJobs.length ? (
                      selected.recentJobs.map(job => (
                        <div
                          key={job.id}
                          className="grid grid-cols-4 border-t border-zinc-100 px-4 py-3 text-xs"
                        >
                          <span>#{job.id}</span>
                          <span className="capitalize">{job.status}</span>
                          <span>
                            {job.resolution} · {job.aspectRatio}
                          </span>
                          <span className="text-zinc-400">
                            {formatDate(job.createdAt)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="p-5 text-center text-sm text-zinc-400">
                        No generation activity yet.
                      </p>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-400">
                    <span>{selected.projectCount} projects</span>
                    <span>{selected.imageCount} uploaded images</span>
                    <span>
                      Last signed in {formatDate(selected.lastSignedIn)}
                    </span>
                  </div>
                </section>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
