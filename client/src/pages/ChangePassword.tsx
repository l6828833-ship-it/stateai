import { FormEvent, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Clapperboard, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export default function ChangePassword() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) navigate("/login");
    else if (!user.mustChangePassword) navigate("/dashboard");
  }, [loading, navigate, user]);

  const mutation = trpc.auth.changePassword.useMutation({
    onSuccess: async result => {
      utils.auth.me.setData(undefined, result.user);
      await utils.auth.me.invalidate();
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success(
        "Password changed. Your other sessions have been signed out."
      );
      navigate("/dashboard");
    },
    onError: mutationError => setError(mutationError.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (newPassword.length < 12) {
      setError("Use at least 12 characters for your new password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }
    if (newPassword === currentPassword) {
      setError(
        "Choose a new password that is different from the temporary password."
      );
      return;
    }
    mutation.mutate({ currentPassword, newPassword });
  };

  if (loading || !user || !user.mustChangePassword) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/20">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-muted/20 px-4 py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(247,184,208,0.35),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(201,138,214,0.25),transparent_38%)]" />
      <main className="relative w-full max-w-md rounded-3xl border bg-background/90 p-7 shadow-2xl backdrop-blur-xl sm:p-9">
        <div className="flex items-center gap-2 font-display text-lg">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Clapperboard className="h-4 w-4" />
          </span>
          EstateTour AI
        </div>
        <div className="mt-7 flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-950 text-white">
          <KeyRound className="h-5 w-5" />
        </div>
        <h1 className="mt-5 font-display text-2xl">Create a new password</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          An administrator issued a one-time temporary password. Change it
          before continuing to your account.
        </p>

        {error && (
          <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Temporary password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={event => setCurrentPassword(event.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={event => setNewPassword(event.target.value)}
              minLength={12}
              required
            />
            <p className="text-xs text-muted-foreground">
              Use at least 12 characters and do not reuse the temporary
              password.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={event => setConfirmPassword(event.target.value)}
              minLength={12}
              required
            />
          </div>
          <Button
            type="submit"
            className="mt-2 w-full rounded-full py-6"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Change password and continue"
            )}
          </Button>
        </form>
        <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          For your security, changing the password revokes all previous
          sessions. Administrators cannot view your password.
        </p>
      </main>
    </div>
  );
}
