import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Brain,
  Camera,
  Clapperboard,
  Download,
  Film,
  Lock,
  Play,
  Sparkles,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * GenerationTheater renders the video "output" area in three modes:
 *
 * - "fake": a staged progress performance for non-subscribers. It looks like a
 *   real render (analysis → camera planning → rendering → grading) and ends in
 *   a blurred "ready" preview with a lock overlay that opens the pricing modal.
 * - "real": actual generation progress while the backend job is processing;
 *   ends with the playable video.
 * - "ready": a completed video with player + download.
 */

export type TheaterMode = "idle" | "fake" | "real";

const STAGES = [
  { icon: Brain, label: "Analyzing your photos", detail: "Reading room geometry & lighting" },
  { icon: Camera, label: "Planning camera paths", detail: "Choreographing every move" },
  { icon: Film, label: "Rendering frames", detail: "Painting your tour frame by frame" },
  { icon: Wand2, label: "Color grading", detail: "Applying the final cinematic polish" },
] as const;

interface GenerationTheaterProps {
  mode: TheaterMode;
  /** First photo of the sequence, used as the blurred preview backdrop */
  previewImageUrl?: string | null;
  /** Real job state (mode === "real") */
  jobStatus?: "processing" | "ready" | "failed" | null;
  videoUrl?: string | null;
  errorMessage?: string | null;
  /** Called when fake flow finishes its performance (blurred preview shown) */
  onFakeComplete?: () => void;
  /** Open the pricing modal (locked preview clicked) */
  onUnlockClick?: () => void;
  onDownload?: () => void;
  /** Fake performance duration in ms (default ~14s, feels like a real render) */
  fakeDurationMs?: number;
}

export default function GenerationTheater({
  mode,
  previewImageUrl,
  jobStatus,
  videoUrl,
  errorMessage,
  onFakeComplete,
  onUnlockClick,
  onDownload,
  fakeDurationMs = 14000,
}: GenerationTheaterProps) {
  const [progress, setProgress] = useState(0);
  const [fakeDone, setFakeDone] = useState(false);
  const completedRef = useRef(false);

  // Drive the fake (and cosmetic real) progress.
  useEffect(() => {
    if (mode === "idle") {
      setProgress(0);
      setFakeDone(false);
      completedRef.current = false;
      return;
    }
    setProgress(0);
    setFakeDone(false);
    completedRef.current = false;

    const start = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      if (mode === "fake") {
        // Ease toward 100% across fakeDurationMs with organic jitter.
        const t = Math.min(1, elapsed / fakeDurationMs);
        const eased = 1 - Math.pow(1 - t, 2.2);
        const jitter = Math.sin(elapsed / 700) * 1.2;
        const value = Math.min(100, Math.max(0, eased * 100 + jitter * (1 - t)));
        setProgress(t >= 1 ? 100 : value);
        if (t >= 1 && !completedRef.current) {
          completedRef.current = true;
          setFakeDone(true);
          clearInterval(tick);
          onFakeComplete?.();
        }
      } else {
        // Real: asymptotic progress that never hits 100 until the job is ready.
        setProgress((p) => Math.min(94, p + (94 - p) * 0.012));
      }
    }, 120);
    return () => clearInterval(tick);
  }, [mode, fakeDurationMs, onFakeComplete]);

  const stageIndex = useMemo(() => {
    if (progress < 22) return 0;
    if (progress < 48) return 1;
    if (progress < 82) return 2;
    return 3;
  }, [progress]);

  if (mode === "idle") return null;

  const isRealReady = mode === "real" && jobStatus === "ready" && videoUrl;
  const isRealFailed = mode === "real" && jobStatus === "failed";
  const showRendering = (mode === "fake" && !fakeDone) || (mode === "real" && jobStatus === "processing");
  const showLockedPreview = mode === "fake" && fakeDone;

  return (
    <div className="animate-fade-up overflow-hidden rounded-3xl border border-ring/40 bg-card/80">
      {/* ===== Rendering performance ===== */}
      {showRendering && (
        <div className="relative">
          <div className="relative aspect-video overflow-hidden">
            {previewImageUrl ? (
              <img
                src={previewImageUrl}
                alt="Rendering preview"
                className="h-full w-full object-cover opacity-40 blur-md scale-105"
              />
            ) : (
              <div className="h-full w-full animate-shimmer" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/40 to-background/20" />

            {/* Scanline sweep */}
            <div
              className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent"
              style={{
                left: `${((progress * 1.3) % 130) - 15}%`,
                transition: "left 120ms linear",
              }}
            />

            {/* Center status */}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
              <span className="relative flex h-16 w-16 items-center justify-center">
                <span className="absolute inset-0 animate-ping rounded-full bg-primary/25" />
                <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary/90 text-primary-foreground pink-glow">
                  {(() => {
                    const Icon = STAGES[stageIndex].icon;
                    return <Icon className="h-6 w-6" />;
                  })()}
                </span>
              </span>
              <div>
                <p className="font-display text-lg text-foreground">{STAGES[stageIndex].label}</p>
                <p className="mt-1 text-sm text-muted-foreground">{STAGES[stageIndex].detail}</p>
              </div>
            </div>
          </div>

          {/* Progress footer */}
          <div className="space-y-3 p-5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Clapperboard className="h-3.5 w-3.5 text-primary" />
                Generating your tour video…
              </span>
              <span className="font-medium text-foreground">{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2" />
            <div className="flex justify-between">
              {STAGES.map((s, i) => (
                <span
                  key={s.label}
                  className={cn(
                    "flex items-center gap-1 text-[10px] transition-colors duration-500",
                    i <= stageIndex ? "text-primary" : "text-muted-foreground/50",
                  )}
                >
                  <s.icon className="h-3 w-3" />
                  <span className="hidden sm:inline">{s.label.split(" ")[0]}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== Locked blurred preview (fake flow finale) ===== */}
      {showLockedPreview && (
        <div className="relative">
          <div className="relative aspect-video overflow-hidden">
            {previewImageUrl ? (
              <img
                src={previewImageUrl}
                alt="Your tour video preview"
                className="h-full w-full scale-110 object-cover blur-xl brightness-95 animate-ken-burns"
              />
            ) : (
              <div className="h-full w-full animate-shimmer" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#3A2E33]/60 via-transparent to-transparent" />

            {/* Fake player chrome under the blur */}
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 p-4">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-foreground shadow-lg">
                <Play className="ml-0.5 h-4 w-4" />
              </span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/30">
                <div className="h-full w-[8%] rounded-full bg-white/90" />
              </div>
              <span className="text-xs font-medium text-white/90">0:00</span>
            </div>

            {/* Lock overlay */}
            <button
              type="button"
              onClick={onUnlockClick}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center"
              aria-label="Unlock your video"
            >
              <span className="glass-panel flex flex-col items-center gap-3 rounded-2xl px-8 py-6 transition-transform duration-300 hover:scale-[1.03]">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground animate-glow-pulse">
                  <Lock className="h-5 w-5" />
                </span>
                <span>
                  <p className="font-display text-base text-foreground">Your video is ready</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Choose a plan to watch & download it
                  </p>
                </span>
                <span className="btn-springy inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground">
                  <Sparkles className="h-4 w-4" /> Unlock now
                </span>
              </span>
            </button>
          </div>
        </div>
      )}

      {/* ===== Real ready video ===== */}
      {isRealReady && (
        <div className="p-4">
          <video
            src={videoUrl!}
            controls
            playsInline
            className="aspect-video w-full rounded-2xl bg-black object-contain"
          />
          <div className="mt-4 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm text-foreground">
              <Sparkles className="h-4 w-4 text-primary" /> Your cinematic tour is ready
            </p>
            <Button onClick={onDownload} className="btn-springy rounded-full">
              <Download className="mr-1.5 h-4 w-4" /> Download
            </Button>
          </div>
        </div>
      )}

      {/* ===== Real failed ===== */}
      {isRealFailed && (
        <div className="flex flex-col items-center gap-3 p-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Film className="h-5 w-5" />
          </span>
          <p className="font-medium text-foreground">Generation failed</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {errorMessage || "Something went wrong while rendering. You have not been charged for this attempt — please try again."}
          </p>
        </div>
      )}
    </div>
  );
}
