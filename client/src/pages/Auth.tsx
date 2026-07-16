import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  ArrowLeft,
  Clapperboard,
  Eye,
  EyeOff,
  Loader2,
  Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Mode = "signin" | "signup" | "verify";
type VerifyPurpose = "signup" | "login";

/** Multi-color Google "G" logo. */
function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.87z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.63H1.29a12 12 0 0 0 0 10.74l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.63l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  );
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  google_not_configured:
    "Google sign-in isn't configured yet. Please use email instead.",
  google_state: "Google sign-in expired or was interrupted. Please try again.",
  google_token: "Couldn't complete Google sign-in. Please try again.",
  google_userinfo: "Couldn't read your Google profile. Please try again.",
  google: "Google sign-in failed. Please try again.",
};

export default function Auth({
  initialMode = "signin",
}: {
  initialMode?: Mode;
}) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [purpose, setPurpose] = useState<VerifyPurpose>("signup");
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => setMode(initialMode), [initialMode]);
  useEffect(() => setError(null), [mode]);

  // Surface errors bounced back from the Google OAuth callback (?error=...).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err) {
      toast.error(
        AUTH_ERROR_MESSAGES[err] ?? "Sign-in failed. Please try again."
      );
      // Clean the URL so the toast doesn't reappear on refresh.
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Resend cooldown ticker.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const finishAuthed = async () => {
    await utils.auth.me.invalidate();
    const currentUser = await utils.auth.me.fetch();
    navigate(
      currentUser?.mustChangePassword ? "/change-password" : "/dashboard"
    );
  };

  const signupMutation = trpc.auth.signup.useMutation({
    onSuccess: res => {
      setPurpose("signup");
      setCode("");
      setMode("verify");
      setCooldown(30);
      toast.success(`We sent a 6-digit code to ${res.email}`);
    },
    onError: e => setError(e.message),
  });

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async res => {
      if (res.needsVerification) {
        setPurpose("login");
        setCode("");
        setMode("verify");
        setCooldown(30);
        toast("Verify your email to continue — we sent you a code.");
        return;
      }
      toast.success("Welcome back!");
      await finishAuthed();
    },
    onError: e => setError(e.message),
  });

  const verifyMutation = trpc.auth.verifyOtp.useMutation({
    onSuccess: async () => {
      toast.success("Email verified — you're in!");
      await finishAuthed();
    },
    onError: e => setError(e.message),
  });

  const resendMutation = trpc.auth.resendOtp.useMutation({
    onSuccess: () => {
      setCooldown(30);
      toast.success("A new code is on its way.");
    },
    onError: e => {
      setError(e.message);
      setCooldown(30);
    },
  });

  const busy =
    signupMutation.isPending ||
    loginMutation.isPending ||
    verifyMutation.isPending;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === "signup") {
      signupMutation.mutate({ name, email, password });
    } else if (mode === "signin") {
      loginMutation.mutate({ email, password });
    }
  };

  // Auto-submit the OTP once all 6 digits are entered.
  useEffect(() => {
    if (mode === "verify" && code.length === 6 && !verifyMutation.isPending) {
      verifyMutation.mutate({ email, code, purpose });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const heading = useMemo(() => {
    if (mode === "signup")
      return {
        title: "Create your account",
        sub: "Start turning listing photos into cinematic tours.",
      };
    if (mode === "signin")
      return {
        title: "Welcome back",
        sub: "Sign in to your EstateTour AI studio.",
      };
    return {
      title: "Verify your email",
      sub: `Enter the 6-digit code we sent to ${email}.`,
    };
  }, [mode, email]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      {/* Ambient blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -left-32 -top-24 h-[30rem] w-[30rem] rounded-full opacity-50 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, #F7B8D0 0%, #E6C8F0 60%, transparent 75%)",
          }}
        />
        <div
          className="absolute -bottom-32 -right-24 h-[28rem] w-[28rem] rounded-full opacity-40 blur-3xl"
          style={{
            background:
              "radial-gradient(circle, #E894B5 0%, #F0C9DC 55%, transparent 75%)",
          }}
        />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <button
          onClick={() => navigate("/")}
          className="mx-auto mb-6 flex items-center gap-2 font-display text-lg text-foreground"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Clapperboard className="h-4 w-4" />
          </span>
          EstateTour AI
        </button>

        <div className="glass-panel rounded-3xl p-7 sm:p-9">
          {mode === "verify" && (
            <button
              onClick={() =>
                setMode(purpose === "signup" ? "signup" : "signin")
              }
              className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-primary"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
          )}

          <h1 className="font-display text-2xl text-foreground">
            {heading.title}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{heading.sub}</p>

          {error && (
            <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* ===== Sign in / Sign up form ===== */}
          {mode !== "verify" && (
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              {mode === "signup" && (
                <div className="space-y-1.5">
                  <Label htmlFor="name">Full name</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Jordan Rivera"
                    autoComplete="name"
                    required
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@agency.com"
                  autoComplete="email"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder={
                      mode === "signup"
                        ? "At least 8 characters"
                        : "Your password"
                    }
                    autoComplete={
                      mode === "signup" ? "new-password" : "current-password"
                    }
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(s => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={
                      showPassword ? "Hide password" : "Show password"
                    }
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={busy}
                className="btn-springy w-full rounded-full py-6 text-base"
              >
                {busy ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : mode === "signup" ? (
                  "Create account"
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
          )}

          {/* ===== OTP verification ===== */}
          {mode === "verify" && (
            <div className="mt-6">
              <div className="mb-5 flex items-center gap-2 rounded-xl bg-accent/60 px-3.5 py-2.5 text-sm text-accent-foreground">
                <Mail className="h-4 w-4 text-primary" />
                Check your inbox for the code.
              </div>

              <div className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={code}
                  onChange={setCode}
                  disabled={verifyMutation.isPending}
                  containerClassName="gap-2"
                >
                  <InputOTPGroup className="gap-2">
                    {[0, 1, 2, 3, 4, 5].map(i => (
                      <InputOTPSlot
                        key={i}
                        index={i}
                        className="h-12 w-11 rounded-xl border text-lg"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>

              <Button
                onClick={() => verifyMutation.mutate({ email, code, purpose })}
                disabled={code.length !== 6 || verifyMutation.isPending}
                className="btn-springy mt-6 w-full rounded-full py-6 text-base"
              >
                {verifyMutation.isPending ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  "Verify & continue"
                )}
              </Button>

              <div className="mt-4 text-center text-sm text-muted-foreground">
                Didn't get it?{" "}
                <button
                  onClick={() => resendMutation.mutate({ email, purpose })}
                  disabled={cooldown > 0 || resendMutation.isPending}
                  className="font-medium text-primary hover:underline disabled:opacity-50 disabled:no-underline"
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                </button>
              </div>
            </div>
          )}

          {/* ===== OAuth + mode switch ===== */}
          {mode !== "verify" && (
            <>
              <div className="my-6 flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  window.location.href = "/api/auth/google";
                }}
                className="btn-springy w-full gap-2 rounded-full bg-card/60 py-6 text-base"
              >
                <GoogleIcon /> Continue with Google
              </Button>

              <p className="mt-6 text-center text-sm text-muted-foreground">
                {mode === "signup" ? (
                  <>
                    Already have an account?{" "}
                    <button
                      onClick={() => navigate("/login")}
                      className="font-medium text-primary hover:underline"
                    >
                      Sign in
                    </button>
                  </>
                ) : (
                  <>
                    New to EstateTour AI?{" "}
                    <button
                      onClick={() => navigate("/signup")}
                      className="font-medium text-primary hover:underline"
                    >
                      Create an account
                    </button>
                  </>
                )}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
