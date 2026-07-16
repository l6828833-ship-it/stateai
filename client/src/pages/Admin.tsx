import { FormEvent, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Copy,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  Users,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PLANS, type PlanId } from "@shared/plans";

const PAGE_SIZE = 20;

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function createTemporaryPassword() {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join("");
}

function auditMetadata(value: string) {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const entries = Object.entries(parsed);
    if (!entries.length) return "No additional details";
    return entries.map(([key, item]) => `${key}: ${String(item)}`).join(" · ");
  } catch {
    return "Details unavailable";
  }
}

export default function Admin() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState("");

  useEffect(() => {
    if (loading) return;
    if (!user) navigate("/login");
    else if (user.role !== "admin") navigate("/dashboard");
  }, [loading, navigate, user]);

  const usersQuery = trpc.admin.listUsers.useQuery(
    { page, pageSize: PAGE_SIZE, search: search || undefined },
    { enabled: user?.role === "admin", placeholderData: previous => previous }
  );
  const detailsQuery = trpc.admin.userDetails.useQuery(
    { userId: selectedUserId ?? 0 },
    { enabled: user?.role === "admin" && selectedUserId !== null }
  );

  useEffect(() => {
    const rows = usersQuery.data?.rows;
    if (!rows?.length) {
      setSelectedUserId(null);
      return;
    }
    if (!selectedUserId || !rows.some(item => item.id === selectedUserId)) {
      setSelectedUserId(rows[0].id);
    }
  }, [selectedUserId, usersQuery.data?.rows]);

  const refreshAdminData = async () => {
    await Promise.all([
      utils.admin.listUsers.invalidate(),
      utils.admin.userDetails.invalidate(),
      utils.auth.me.invalidate(),
    ]);
  };

  const mutationOptions = {
    onSuccess: async () => {
      await refreshAdminData();
    },
    onError: (error: { message: string }) => toast.error(error.message),
  };
  const statusMutation =
    trpc.admin.setAccountStatus.useMutation(mutationOptions);
  const roleMutation = trpc.admin.setRole.useMutation(mutationOptions);
  const sessionsMutation =
    trpc.admin.revokeSessions.useMutation(mutationOptions);
  const usageMutation = trpc.admin.adjustUsage.useMutation({
    ...mutationOptions,
    onSuccess: async () => {
      await refreshAdminData();
      toast.success("Usage adjustment recorded in the immutable ledger.");
    },
  });
  const planMutation = trpc.admin.changePlan.useMutation({
    ...mutationOptions,
    onSuccess: async result => {
      await refreshAdminData();
      if (result.syncPending) {
        toast.warning(
          "Stripe changed the plan. Local status will refresh from the Stripe webhook shortly."
        );
      } else {
        toast.success(
          "Stripe subscription plan changed with immediate proration."
        );
      }
    },
  });
  const passwordMutation = trpc.admin.issueTemporaryPassword.useMutation({
    ...mutationOptions,
    onSuccess: async () => {
      await refreshAdminData();
      setPasswordDialogOpen(false);
      setTemporaryPassword("");
      toast.success(
        "Temporary password set. The user must change it at next sign-in."
      );
    },
  });

  const totalPages = Math.max(
    1,
    Math.ceil((usersQuery.data?.total ?? 0) / PAGE_SIZE)
  );
  const selected = detailsQuery.data;
  const busy =
    statusMutation.isPending ||
    roleMutation.isPending ||
    sessionsMutation.isPending ||
    usageMutation.isPending ||
    planMutation.isPending ||
    passwordMutation.isPending;

  const summary = useMemo(() => {
    const rows = usersQuery.data?.rows ?? [];
    return {
      active: rows.filter(item => item.accountStatus === "active").length,
      admins: rows.filter(item => item.role === "admin").length,
      subscribed: rows.filter(item =>
        ["active", "trialing"].includes(item.subscriptionStatus ?? "")
      ).length,
    };
  }, [usersQuery.data?.rows]);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const changeStatus = async (status: "active" | "disabled") => {
    if (!selectedUserId || !selected) return;
    if (
      status === "disabled" &&
      !window.confirm(
        `Disable ${selected.user.email ?? selected.user.name ?? "this user"} and revoke their sessions?`
      )
    )
      return;
    try {
      await statusMutation.mutateAsync({ userId: selectedUserId, status });
      toast.success(
        status === "active"
          ? "Account enabled."
          : "Account disabled and sessions revoked."
      );
    } catch {}
  };

  const changeRole = async (role: "user" | "admin") => {
    if (!selectedUserId || !selected || role === selected.user.role) return;
    if (
      !window.confirm(
        `Change this account's role to ${role}? Existing sessions will be revoked.`
      )
    )
      return;
    try {
      await roleMutation.mutateAsync({ userId: selectedUserId, role });
      toast.success(`Role changed to ${role}.`);
    } catch {}
  };

  const changePlan = async (planId: PlanId) => {
    if (!selectedUserId || !selected || planId === selected.subscription?.plan)
      return;
    const plan = PLANS.find(item => item.id === planId);
    if (!plan) return;
    if (
      !window.confirm(
        `Change this Stripe subscription to ${plan.name} ${plan.cadence === "year" ? "yearly" : "monthly"}? Stripe will apply the change now with proration.`
      )
    )
      return;
    try {
      await planMutation.mutateAsync({ userId: selectedUserId, planId });
    } catch {}
  };

  const revokeSessions = async () => {
    if (
      !selectedUserId ||
      !window.confirm("Sign this user out on every device?")
    )
      return;
    try {
      await sessionsMutation.mutateAsync({ userId: selectedUserId });
      toast.success("All sessions revoked.");
    } catch {}
  };

  const adjustUsage = async () => {
    if (!selectedUserId) return;
    const deltaRaw = window.prompt(
      "Usage adjustment: use a negative number to restore videos or a positive number to consume allowance.",
      "-1"
    );
    if (deltaRaw === null) return;
    const delta = Number(deltaRaw);
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100) {
      toast.error("Enter a non-zero whole number between -100 and 100.");
      return;
    }
    const reason = window.prompt(
      "Reason for this auditable adjustment:",
      "Support correction"
    );
    if (!reason || reason.trim().length < 3) {
      toast.error("A reason of at least 3 characters is required.");
      return;
    }
    try {
      await usageMutation.mutateAsync({
        userId: selectedUserId,
        delta,
        reason: reason.trim(),
      });
    } catch {}
  };

  const openPasswordDialog = () => {
    setTemporaryPassword(createTemporaryPassword());
    setPasswordDialogOpen(true);
  };

  const copyPassword = async () => {
    await navigator.clipboard.writeText(temporaryPassword);
    toast.success(
      "Temporary password copied. Share it through a secure channel."
    );
  };

  if (loading || (user?.role === "admin" && usersQuery.isLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/20">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }
  if (!user || user.role !== "admin") return null;

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/dashboard")}
              aria-label="Back to dashboard"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-zinc-950 text-white">
              <ShieldCheck className="h-4 w-4" />
            </span>
            <div>
              <h1 className="font-display text-lg">Admin dashboard</h1>
              <p className="hidden text-xs text-muted-foreground sm:block">
                Secure account and subscription operations
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground md:inline">
              {user.email}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refreshAdminData()}
              disabled={busy}
            >
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: "Total users",
              value: usersQuery.data?.total ?? 0,
              icon: Users,
            },
            { label: "Active on page", value: summary.active, icon: UserRound },
            {
              label: "Admins on page",
              value: summary.admins,
              icon: ShieldCheck,
            },
            {
              label: "Paid on page",
              value: summary.subscribed,
              icon: CircleDollarSign,
            },
          ].map(item => (
            <Card key={item.label} className="gap-3 py-4">
              <CardContent className="flex items-center justify-between px-4">
                <div>
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="mt-1 text-2xl font-bold">{item.value}</p>
                </div>
                <item.icon className="h-5 w-5 text-primary" />
              </CardContent>
            </Card>
          ))}
        </section>

        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(380px,0.65fr)]">
          <Card className="min-w-0 gap-4 py-5">
            <CardHeader className="gap-4 px-4 sm:px-6 md:grid-cols-[1fr_auto]">
              <div>
                <CardTitle>Users</CardTitle>
                <CardDescription>
                  Search by name, email, or account ID.
                </CardDescription>
              </div>
              <form
                onSubmit={submitSearch}
                className="flex w-full gap-2 md:w-80"
              >
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchInput}
                    onChange={event => setSearchInput(event.target.value)}
                    className="pl-9"
                    placeholder="Search users"
                  />
                </div>
                <Button type="submit" size="sm">
                  Search
                </Button>
              </form>
            </CardHeader>
            <CardContent className="px-0">
              {usersQuery.error ? (
                <p className="px-6 py-10 text-center text-sm text-destructive">
                  {usersQuery.error.message}
                </p>
              ) : usersQuery.data?.rows.length === 0 ? (
                <p className="px-6 py-10 text-center text-sm text-muted-foreground">
                  No users match this search.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">User</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Plan / payment</TableHead>
                      <TableHead className="pr-6">Last sign-in</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {usersQuery.data?.rows.map(item => (
                      <TableRow
                        key={item.id}
                        data-state={
                          selectedUserId === item.id ? "selected" : undefined
                        }
                        className="cursor-pointer"
                        onClick={() => setSelectedUserId(item.id)}
                      >
                        <TableCell className="pl-6">
                          <p className="max-w-52 truncate font-medium">
                            {item.name || "Unnamed user"}
                          </p>
                          <p className="max-w-52 truncate text-xs text-muted-foreground">
                            {item.email || item.openId}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              item.role === "admin" ? "default" : "outline"
                            }
                          >
                            {item.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              item.accountStatus === "active"
                                ? "secondary"
                                : "destructive"
                            }
                          >
                            {item.accountStatus}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <p className="text-xs font-medium">
                            {item.subscriptionPlan ?? "No plan"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item.subscriptionStatus ?? "No payment"}
                          </p>
                        </TableCell>
                        <TableCell className="pr-6 text-xs text-muted-foreground">
                          {formatDate(item.lastSignedIn)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
            <div className="flex items-center justify-between border-t px-4 pt-4 sm:px-6">
              <p className="text-xs text-muted-foreground">
                Page {page} of {totalPages} · {usersQuery.data?.total ?? 0}{" "}
                users
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  disabled={page <= 1}
                  onClick={() => setPage(value => value - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={page >= totalPages}
                  onClick={() => setPage(value => value + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>

          <Card className="min-w-0 gap-5 py-5">
            <CardHeader>
              <CardTitle>User details</CardTitle>
              <CardDescription>
                Account, security, subscription, and usage.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {detailsQuery.isLoading ? (
                <div className="flex h-60 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : detailsQuery.error ? (
                <p className="py-12 text-center text-sm text-destructive">
                  {detailsQuery.error.message}
                </p>
              ) : selected ? (
                <>
                  <div className="rounded-2xl border bg-muted/30 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="font-semibold">
                          {selected.user.name || "Unnamed user"}
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          {selected.user.email || "No email"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          ID {selected.user.id} ·{" "}
                          {selected.user.loginMethod || "unknown login"}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Badge
                          variant={
                            selected.user.accountStatus === "active"
                              ? "secondary"
                              : "destructive"
                          }
                        >
                          {selected.user.accountStatus}
                        </Badge>
                        <Badge
                          variant={
                            selected.user.role === "admin"
                              ? "default"
                              : "outline"
                          }
                        >
                          {selected.user.role}
                        </Badge>
                      </div>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <dt className="text-muted-foreground">Created</dt>
                        <dd className="mt-1 font-medium">
                          {formatDate(selected.user.createdAt)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Last sign-in</dt>
                        <dd className="mt-1 font-medium">
                          {formatDate(selected.user.lastSignedIn)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">
                          Email verification
                        </dt>
                        <dd className="mt-1 font-medium">
                          {selected.user.emailVerified
                            ? "Verified"
                            : "Unverified"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">
                          Password state
                        </dt>
                        <dd className="mt-1 font-medium">
                          {selected.user.mustChangePassword
                            ? "Change required"
                            : "Normal"}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border p-4">
                      <Video className="h-4 w-4 text-primary" />
                      <p className="mt-3 text-2xl font-bold">
                        {selected.usage.currentWindow}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Videos in allowance window
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {selected.usage.total} lifetime ·{" "}
                        {selected.usage.adjustmentCurrentWindow >= 0 ? "+" : ""}
                        {selected.usage.adjustmentCurrentWindow} adjusted
                      </p>
                    </div>
                    <div className="rounded-2xl border p-4">
                      <CircleDollarSign className="h-4 w-4 text-primary" />
                      <p className="mt-3 truncate text-sm font-bold">
                        {selected.subscription?.plan ?? "No plan"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {selected.subscription?.status ?? "No payment"}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Renews{" "}
                        {formatDate(selected.subscription?.currentPeriodEnd)}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold">Controls</h3>
                    <label className="block space-y-1.5 text-xs text-muted-foreground">
                      Stripe plan
                      <Select
                        value={selected.subscription?.plan ?? undefined}
                        onValueChange={value =>
                          void changePlan(value as PlanId)
                        }
                        disabled={
                          busy || !selected.subscription?.stripeSubscriptionId
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue
                            placeholder={
                              selected.subscription?.stripeSubscriptionId
                                ? "Choose a plan"
                                : "No Stripe subscription"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {PLANS.map(plan => (
                            <SelectItem key={plan.id} value={plan.id}>
                              {plan.name} ·{" "}
                              {plan.cadence === "year"
                                ? `$${plan.totalPrice}/yr`
                                : `$${plan.totalPrice}/mo`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="block text-[10px]">
                        Changes are sent to Stripe immediately with proration;
                        local records update only after Stripe succeeds.
                      </span>
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1.5 text-xs text-muted-foreground">
                        Role
                        <Select
                          value={selected.user.role}
                          onValueChange={value =>
                            void changeRole(value as "user" | "admin")
                          }
                          disabled={busy}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="user">User</SelectItem>
                            <SelectItem value="admin">Administrator</SelectItem>
                          </SelectContent>
                        </Select>
                      </label>
                      <label className="space-y-1.5 text-xs text-muted-foreground">
                        Account status
                        <Select
                          value={selected.user.accountStatus}
                          onValueChange={value =>
                            void changeStatus(value as "active" | "disabled")
                          }
                          disabled={busy}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="disabled">Disabled</SelectItem>
                          </SelectContent>
                        </Select>
                      </label>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <Button
                        variant="outline"
                        onClick={openPasswordDialog}
                        disabled={busy || selected.user.id === user.id}
                        title={
                          selected.user.id === user.id
                            ? "Use your account password-change flow for your own password"
                            : undefined
                        }
                      >
                        <KeyRound className="mr-2 h-4 w-4" /> Temporary password
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void adjustUsage()}
                        disabled={busy}
                      >
                        <Video className="mr-2 h-4 w-4" /> Adjust usage
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void revokeSessions()}
                        disabled={busy}
                      >
                        <LogOut className="mr-2 h-4 w-4" /> Revoke sessions
                      </Button>
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Existing passwords are securely hashed and can never be
                      viewed. Temporary passwords force a password change and
                      revoke existing sessions.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold">
                      Payment connection
                    </h3>
                    <div className="rounded-2xl border p-4 text-xs">
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">
                          Stripe customer
                        </span>
                        <span className="font-medium">
                          {selected.subscription?.stripeCustomerId
                            ? "Connected"
                            : "Not connected"}
                        </span>
                      </div>
                      <div className="mt-2 flex justify-between gap-3">
                        <span className="text-muted-foreground">
                          Subscription
                        </span>
                        <span className="font-medium">
                          {selected.subscription?.stripeSubscriptionId
                            ? "Connected"
                            : "Not connected"}
                        </span>
                      </div>
                      <div className="mt-2 flex justify-between gap-3">
                        <span className="text-muted-foreground">
                          Payment status
                        </span>
                        <span className="font-medium">
                          {selected.subscription?.status ?? "No payment record"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold">
                      Recent audit history
                    </h3>
                    {selected.recentAudits.length ? (
                      <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                        {selected.recentAudits.map(audit => (
                          <div key={audit.id} className="rounded-xl border p-3">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-xs font-semibold">
                                {audit.action.replaceAll(".", " · ")}
                              </p>
                              <time className="shrink-0 text-[10px] text-muted-foreground">
                                {formatDate(audit.createdAt)}
                              </time>
                            </div>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {auditMetadata(audit.metadata)}
                            </p>
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              Admin ID {audit.adminId}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
                        No administrative actions for this user.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  Select a user to view details.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set a temporary password</DialogTitle>
            <DialogDescription>
              This replaces the current password, revokes every session, and
              forces a password change at the next sign-in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="text-sm font-medium" htmlFor="temporary-password">
              Temporary password
            </label>
            <div className="flex gap-2">
              <Input
                id="temporary-password"
                type="text"
                autoComplete="off"
                value={temporaryPassword}
                onChange={event => setTemporaryPassword(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => void copyPassword()}
                aria-label="Copy temporary password"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p
              className={cn(
                "text-xs",
                temporaryPassword.length >= 12
                  ? "text-muted-foreground"
                  : "text-destructive"
              )}
            >
              At least 12 characters. Share it once through a secure channel; it
              is never retrievable from the server.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPasswordDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={
                temporaryPassword.length < 12 ||
                passwordMutation.isPending ||
                !selectedUserId ||
                selectedUserId === user.id
              }
              onClick={() =>
                selectedUserId &&
                passwordMutation.mutate({
                  userId: selectedUserId,
                  temporaryPassword,
                })
              }
            >
              {passwordMutation.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}{" "}
              Set temporary password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
