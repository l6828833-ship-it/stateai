import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function ChangePassword() {
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const utils = trpc.useUtils();
  const mutation = trpc.auth.changePassword.useMutation();

  useEffect(() => {
    if (!loading && !user) navigate("/login");
    if (!loading && user && !user.forcePasswordChange) navigate("/dashboard");
  }, [loading, navigate, user]);

  if (loading || !user) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    try {
      await mutation.mutateAsync({ currentPassword, newPassword });
      await utils.auth.me.invalidate();
      toast.success("Password updated. Other sessions were signed out.");
      navigate("/dashboard");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update password"
      );
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-16">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(247,184,208,.28),transparent_42%)]" />
      <form
        onSubmit={submit}
        className="relative w-full max-w-md rounded-3xl border border-zinc-200 bg-white/90 p-7 shadow-2xl shadow-zinc-950/10 backdrop-blur-xl sm:p-9"
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-950 text-white">
          <KeyRound className="h-5 w-5" />
        </span>
        <h1 className="mt-5 font-display text-2xl text-zinc-950">
          Create a new password
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          An administrator issued a temporary password. Replace it before
          continuing to your studio.
        </p>
        <div className="mt-7 space-y-4">
          <label className="block text-sm font-medium text-zinc-700">
            Temporary password
            <Input
              className="mt-1.5"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={event => setCurrentPassword(event.target.value)}
              required
            />
          </label>
          <label className="block text-sm font-medium text-zinc-700">
            New password
            <Input
              className="mt-1.5"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={newPassword}
              onChange={event => setNewPassword(event.target.value)}
              required
            />
          </label>
          <label className="block text-sm font-medium text-zinc-700">
            Confirm new password
            <Input
              className="mt-1.5"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={confirmPassword}
              onChange={event => setConfirmPassword(event.target.value)}
              required
            />
          </label>
        </div>
        <Button
          type="submit"
          disabled={mutation.isPending}
          className="mt-6 h-11 w-full rounded-full bg-zinc-950 text-white hover:bg-zinc-800"
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Save password and continue"
          )}
        </Button>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-zinc-400">
          <ShieldCheck className="h-3.5 w-3.5" /> All other sessions will be
          revoked
        </p>
      </form>
    </main>
  );
}
