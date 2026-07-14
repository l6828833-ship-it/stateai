import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import TourTool, { type ToolImage, type ToolSettings } from "@/components/TourTool";
import GenerationTheater, { type TheaterMode } from "@/components/GenerationTheater";
import PricingModal from "@/components/PricingModal";
import DashboardSidebar from "@/components/DashboardSidebar";
import DashboardBottomNav from "@/components/DashboardBottomNav";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { loadDraft, clearDraft } from "@/hooks/useToolDraft";
import type { PlanId, TourStyleId } from "@shared/plans";
import {
  BadgeCheck,
  Clapperboard,
  CreditCard,
  Crown,
  Download,
  Film,
  History,
  Loader2,
  LogOut,
  Menu,
  RefreshCw,
  Zap,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function StatusBadge({ status }: { status: "processing" | "ready" | "failed" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        status === "processing" && "bg-accent text-accent-foreground",
        status === "ready" && "bg-primary/15 text-primary",
        status === "failed" && "bg-destructive/10 text-destructive",
      )}
    >
      {status === "processing" && <Loader2 className="h-3 w-3 animate-spin" />}
      {status === "ready" && <BadgeCheck className="h-3 w-3" />}
      {status === "failed" && <XCircle className="h-3 w-3" />}
      {status}
    </span>
  );
}

export default function Dashboard() {
  const { user, loading: authLoading, isAuthenticated, logout } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const [theaterMode, setTheaterMode] = useState<TheaterMode>("idle");
  const [pricingOpen, setPricingOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [draftSyncing, setDraftSyncing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const draftSyncedRef = useRef(false);

  const stateQuery = trpc.tour.getState.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const jobsQuery = trpc.tour.listJobs.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const project = stateQuery.data?.project;
  const serverImages = stateQuery.data?.images ?? [];
  const subscribed = stateQuery.data?.subscribed ?? false;
  const currentPlan = stateQuery.data?.plan ?? null;

  const uploadMutation = trpc.tour.uploadImage.useMutation();
  const reorderMutation = trpc.tour.reorderImages.useMutation({
    onSuccess: () => utils.tour.getState.invalidate(),
    onError: (e) => {
      toast.error(e.message);
      utils.tour.getState.invalidate();
    },
  });
  const deleteMutation = trpc.tour.deleteImage.useMutation({
    onSuccess: () => utils.tour.getState.invalidate(),
  });
  const settingsMutation = trpc.tour.updateSettings.useMutation({
    onSuccess: () => utils.tour.getState.invalidate(),
  });
  const generateMutation = trpc.tour.generate.useMutation();
  const downloadMutation = trpc.tour.getDownloadUrl.useMutation();

  // Redirect anonymous visitors to login.
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      startLogin();
    }
  }, [authLoading, isAuthenticated]);

  // ===== One-time draft sync: restore homepage uploads/settings after signup =====
  useEffect(() => {
    if (!isAuthenticated || !project || draftSyncedRef.current || draftSyncing) return;
    const draft = loadDraft();
    const hasDraft = draft.images.length > 0 || draft.creativeText || draft.pendingGenerate;
    if (!hasDraft) {
      draftSyncedRef.current = true;
      return;
    }

    draftSyncedRef.current = true;
    setDraftSyncing(true);
    (async () => {
      try {
        // Push settings first.
        await settingsMutation.mutateAsync({
          projectId: project.id,
          tourStyle: draft.tourStyle as TourStyleId,
          creativeText: draft.creativeText || null,
          resolution: draft.resolution as "480p" | "720p" | "1080p",
          aspectRatio: draft.aspectRatio as "16:9" | "9:16" | "1:1" | "4:3" | "21:9",
          clipDuration: draft.clipDuration,
        });
        // Upload images strictly one-by-one, in draft order, so the
        // server-assigned sequence indexes match the user's arrangement.
        for (const img of draft.images) {
          const base64 = img.dataUrl.split(",")[1] ?? "";
          if (!base64) continue;
          await uploadMutation.mutateAsync({
            projectId: project.id,
            fileName: img.fileName,
            mimeType: "image/jpeg",
            base64Data: base64,
            roomTag: img.roomTag,
          });
        }
        const shouldAutoGenerate = draft.pendingGenerate;
        clearDraft();
        await utils.tour.getState.invalidate();
        if (draft.images.length > 0) {
          toast.success("Your photos and settings were restored from the homepage");
        }
        if (shouldAutoGenerate) {
          // Continue the flow the user started before signing up.
          setTimeout(() => handleGenerateRef.current?.(), 800);
        }
      } catch (e) {
        toast.error("Some photos could not be restored — please re-upload them");
        clearDraft();
        await utils.tour.getState.invalidate();
      } finally {
        setDraftSyncing(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, project?.id]);

  // ===== Real job polling =====
  const pollQuery = trpc.tour.pollJob.useQuery(
    { jobId: activeJobId ?? 0 },
    {
      enabled: activeJobId !== null && theaterMode === "real",
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "processing" ? 5000 : false;
      },
    },
  );
  const activeJob = pollQuery.data ?? null;

  useEffect(() => {
    if (activeJob && activeJob.status !== "processing") {
      jobsQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob?.status]);

  // ===== Handlers =====
  const handleFilesAdded = async (files: File[]) => {
    if (!project) return;
    for (const file of files) {
      try {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(
            null,
            Array.from(bytes.subarray(i, i + chunk)),
          );
        }
        const base64 = btoa(binary);
        await uploadMutation.mutateAsync({
          projectId: project.id,
          fileName: file.name,
          mimeType: (file.type || "image/jpeg") as string,
          base64Data: base64,
        });
      } catch (e) {
        toast.error(`Failed to upload ${file.name}`);
      }
    }
    utils.tour.getState.invalidate();
  };

  const handleReorder = (orderedIds: Array<string | number>) => {
    if (!project) return;
    const ids = orderedIds.map((id) => Number(id));
    // Optimistic: update cache immediately.
    utils.tour.getState.setData(undefined, (prev) => {
      if (!prev) return prev;
      const byId = new Map(prev.images.map((i) => [i.id, i]));
      const reordered = ids
        .map((id, idx) => {
          const img = byId.get(id);
          return img ? { ...img, sequenceIndex: idx } : null;
        })
        .filter((i): i is NonNullable<typeof i> => Boolean(i));
      return { ...prev, images: reordered };
    });
    reorderMutation.mutate({ projectId: project.id, orderedImageIds: ids });
  };

  const handleDelete = (id: string | number) => {
    deleteMutation.mutate({ imageId: Number(id) });
  };

  const handleSettingsChange = (patch: Partial<ToolSettings>) => {
    if (!project) return;
    // Optimistic cache update for snappy UI.
    utils.tour.getState.setData(undefined, (prev) =>
      prev ? { ...prev, project: { ...prev.project, ...patch } } : prev,
    );
    settingsMutation.mutate({
      projectId: project.id,
      ...(patch.tourStyle ? { tourStyle: patch.tourStyle } : {}),
      ...(patch.creativeText !== undefined ? { creativeText: patch.creativeText || null } : {}),
      ...(patch.resolution ? { resolution: patch.resolution as "480p" | "720p" | "1080p" } : {}),
      ...(patch.aspectRatio
        ? { aspectRatio: patch.aspectRatio as "16:9" | "9:16" | "1:1" | "4:3" | "21:9" }
        : {}),
      ...(patch.clipDuration ? { clipDuration: patch.clipDuration } : {}),
    });
  };

  const handleGenerate = useCallback(async () => {
    if (!project) return;
    const state = utils.tour.getState.getData();
    const imgs = state?.images ?? [];
    if (imgs.length === 0) {
      toast.error("Add at least one photo first");
      return;
    }

    if (!state?.subscribed) {
      // NON-SUBSCRIBER: staged performance, then blurred preview + pricing.
      setTheaterMode("fake");
      document.getElementById("output-theater")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    // SUBSCRIBER: real, costly generation.
    try {
      setTheaterMode("real");
      document.getElementById("output-theater")?.scrollIntoView({ behavior: "smooth", block: "center" });
      const job = await generateMutation.mutateAsync({ projectId: project.id });
      setActiveJobId(job.id);
      jobsQuery.refetch();
    } catch (e) {
      setTheaterMode("idle");
      toast.error(e instanceof Error ? e.message : "Generation failed to start");
      jobsQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  const handleGenerateRef = useRef<typeof handleGenerate | null>(null);
  useEffect(() => {
    handleGenerateRef.current = handleGenerate;
  }, [handleGenerate]);

  const handleSelectPlan = async (planId: PlanId) => {
    try {
      // Stripe checkout is wired via the billing router (phase 5).
      const res = await fetch(`/api/billing/checkout?plan=${planId}`, { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error(data.error || "Could not start checkout — please try again");
      }
    } catch {
      toast.error("Could not start checkout — please try again");
    }
  };

  const handleOpenBillingPortal = async () => {
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error(data.error || "Billing portal unavailable");
      }
    } catch {
      toast.error("Billing portal unavailable");
    }
  };

  const handleDownload = async (jobId: number) => {
    try {
      const { url } = await downloadMutation.mutateAsync({ jobId });
      const a = document.createElement("a");
      a.href = url;
      a.download = `estatetour-video-${jobId}.mp4`;
      a.click();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    }
  };

  // ===== Render =====
  if (authLoading || (isAuthenticated && stateQuery.isLoading)) {
    return (
      <div className="container min-h-screen py-24">
        <Skeleton className="h-10 w-64 rounded-full" />
        <Skeleton className="mt-8 h-72 w-full rounded-3xl" />
      </div>
    );
  }
  if (!isAuthenticated) return null;

  const toolImages: ToolImage[] = serverImages.map((img) => ({
    id: img.id,
    previewUrl: img.url,
    fileName: img.fileName ?? "photo",
    roomTag: img.roomTag,
  }));

  const settings: ToolSettings = {
    tourStyle: (project?.tourStyle ?? "Walkthrough") as TourStyleId,
    creativeText: project?.creativeText ?? "",
    resolution: project?.resolution ?? "720p",
    aspectRatio: project?.aspectRatio ?? "16:9",
    clipDuration: project?.clipDuration ?? 5,
  };

  const firstImageUrl = toolImages[0]?.previewUrl ?? null;
  const jobs = jobsQuery.data ?? [];

  return (
    <div className="min-h-screen">
      {/* ===== Top bar ===== */}
      <header className="sticky top-0 z-40">
        <div className="container flex h-16 items-center justify-between">
          <a href="/" className="flex items-center gap-2 font-display text-lg text-foreground">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Clapperboard className="h-4 w-4" />
            </span>
            EstateTour AI
          </a>
          <div className="flex items-center gap-2">
            {subscribed ? (
              <span className="hidden items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground sm:inline-flex">
                <Crown className="h-3.5 w-3.5 text-primary" />
                {currentPlan ? currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1) : "Active"} plan
              </span>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="btn-springy rounded-full bg-card"
                onClick={() => setPricingOpen(true)}
              >
                <Crown className="mr-1.5 h-3.5 w-3.5 text-primary" /> Upgrade
              </Button>
            )}
            {subscribed && (
              <Button
                size="sm"
                variant="ghost"
                className="btn-springy rounded-full"
                onClick={handleOpenBillingPortal}
              >
                <CreditCard className="mr-1.5 h-3.5 w-3.5" /> Billing
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="btn-springy rounded-full text-muted-foreground"
              onClick={() => logout().then(() => navigate("/"))}
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="glass-panel absolute inset-0 -z-10 rounded-none border-x-0 border-t-0" />
      </header>

      <main className="container pb-24 pt-10">
        <div className="mb-8">
          <h1 className="font-display text-2xl text-foreground sm:text-3xl">
            Welcome back{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your studio is exactly as you left it — photos, order, and settings included.
          </p>
        </div>

        {draftSyncing && (
          <div className="mb-6 flex items-center gap-3 rounded-2xl border border-ring/50 bg-accent/40 p-4 text-sm text-accent-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Restoring the photos and settings you prepared on the homepage…
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[1fr_minmax(20rem,26rem)]">
          {/* ===== The tool ===== */}
          <section className="glass-panel rounded-3xl p-6 sm:p-8">
            <TourTool
              images={toolImages}
              settings={settings}
              onFilesAdded={handleFilesAdded}
              onReorder={handleReorder}
              onDelete={handleDelete}
              onSettingsChange={handleSettingsChange}
              onGenerate={handleGenerate}
              generateLabel={subscribed ? "Generate Tour Video" : "Generate Tour Video"}
              generating={generateMutation.isPending || (theaterMode === "real" && activeJob?.status === "processing")}
              disabled={draftSyncing}
            />
          </section>

          {/* ===== Output + history column ===== */}
          <div className="space-y-6">
            {/* Output theater */}
            <section id="output-theater">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                <Film className="h-4 w-4 text-primary" /> Output
              </h2>
              {theaterMode === "idle" ? (
                <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-ring/50 bg-card/50 p-6 text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent">
                    <Clapperboard className="h-5 w-5 text-primary" />
                  </span>
                  <p className="text-sm text-muted-foreground">
                    Your generated tour will appear here
                  </p>
                </div>
              ) : (
                <GenerationTheater
                  mode={theaterMode}
                  previewImageUrl={firstImageUrl}
                  jobStatus={theaterMode === "real" ? ((activeJob?.status ?? "processing") as "processing" | "ready" | "failed") : null}
                  videoUrl={activeJob?.videoUrl ?? null}
                  errorMessage={activeJob?.errorMessage ?? null}
                  onFakeComplete={() => {
                    // Blurred preview appears first; pricing pops over it a beat later.
                    setTimeout(() => setPricingOpen(true), 900);
                  }}
                  onUnlockClick={() => setPricingOpen(true)}
                  onDownload={() => activeJobId && handleDownload(activeJobId)}
                />
              )}
            </section>

            {/* History */}
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                <History className="h-4 w-4 text-primary" /> Your videos
              </h2>
              {jobs.length === 0 ? (
                <div className="rounded-2xl border border-border bg-card/50 p-5 text-center text-sm text-muted-foreground">
                  No videos yet — your generation history will live here.
                </div>
              ) : (
                <ul className="space-y-3">
                  {jobs.map((job) => (
                    <li
                      key={job.id}
                      className="soft-card-hover flex items-center gap-3 rounded-2xl border border-border bg-card/70 p-3"
                    >
                      <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
                        {job.thumbnailUrl ? (
                          <img
                            src={job.thumbnailUrl}
                            alt="Tour thumbnail"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <Film className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {job.tourStyle} tour · {job.resolution}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {new Date(job.createdAt).toLocaleString()}
                        </p>
                        <div className="mt-1">
                          <StatusBadge status={job.status as "processing" | "ready" | "failed"} />
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1.5">
                        {job.status === "ready" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="btn-springy h-7 rounded-full bg-card px-2.5 text-xs"
                            onClick={() =>
                              subscribed ? handleDownload(job.id) : setPricingOpen(true)
                            }
                          >
                            <Download className="mr-1 h-3 w-3" /> Get
                          </Button>
                        )}
                        {job.status === "processing" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="btn-springy h-7 rounded-full px-2.5 text-xs"
                            onClick={() => {
                              setActiveJobId(job.id);
                              setTheaterMode("real");
                            }}
                          >
                            <RefreshCw className="mr-1 h-3 w-3" /> View
                          </Button>
                        )}
                        {job.status === "failed" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="btn-springy h-7 rounded-full px-2.5 text-xs"
                            onClick={handleGenerate}
                          >
                            <RefreshCw className="mr-1 h-3 w-3" /> Retry
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </main>

      {/* ===== Pricing popup ===== */}
      <PricingModal
        open={pricingOpen}
        onOpenChange={setPricingOpen}
        onSelectPlan={handleSelectPlan}
      />
    </div>
  );
}
