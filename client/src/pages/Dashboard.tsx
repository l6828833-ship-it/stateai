import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { dataUrlToBase64, prepareImageForUpload } from "@/lib/imageUpload";
import TourTool, { type ToolImage, type ToolSettings } from "@/components/TourTool";
import GenerationTheater, { type TheaterMode } from "@/components/GenerationTheater";
import PricingModal from "@/components/PricingModal";
import DashboardSidebar from "@/components/DashboardSidebar";
import DashboardBottomNav from "@/components/DashboardBottomNav";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { clearDraft, loadDraftWithImages, saveDraft } from "@/hooks/useToolDraft";
import type { PlanId } from "@shared/plans";
import {
  BadgeCheck,
  BarChart3,
  CheckCircle2,
  Clapperboard,
  CreditCard,
  Crown,
  Download,
  Film,
  History,
  Loader2,
  Menu,
  RefreshCw,
  Sparkles,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type DashSection = "create" | "videos" | "analytics";

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
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const [theaterMode, setTheaterMode] = useState<TheaterMode>("idle");
  const [pricingOpen, setPricingOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [draftSyncing, setDraftSyncing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<DashSection>("create");
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

  // Redirect anonymous visitors to the sign-in page.
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate("/login");
    }
  }, [authLoading, isAuthenticated, navigate]);

  // ===== One-time draft sync: restore homepage uploads/settings after signup =====
  useEffect(() => {
    if (!isAuthenticated || !project || draftSyncedRef.current || draftSyncing) return;

    draftSyncedRef.current = true;
    setDraftSyncing(true);
    (async () => {
      try {
        const draft = await loadDraftWithImages();
        const hasDraft = draft.images.length > 0 || draft.pendingGenerate;
        if (!hasDraft) return;

        // Push settings first.
        await settingsMutation.mutateAsync({
          projectId: project.id,
          aspectRatio: draft.aspectRatio as "16:9" | "9:16" | "1:1",
        });
        // Upload images strictly one-by-one, in draft order, so the
        // server-assigned sequence indexes match the user's arrangement.
        for (const [index, img] of draft.images.entries()) {
          const mimeType = /^image\/(jpeg|png|webp)$/.test(img.mimeType)
            ? img.mimeType
            : "image/jpeg";
          await uploadMutation.mutateAsync({
            projectId: project.id,
            fileName: img.fileName,
            mimeType,
            base64Data: dataUrlToBase64(img.dataUrl),
            roomTag: img.roomTag,
          });
          // Checkpoint each success so a retry cannot duplicate uploaded photos.
          await saveDraft({ ...draft, images: draft.images.slice(index + 1) });
        }
        const shouldAutoGenerate = draft.pendingGenerate;
        await clearDraft();
        await utils.tour.getState.invalidate();
        if (draft.images.length > 0) {
          toast.success("Your photos and settings were restored from the homepage");
        }
        if (shouldAutoGenerate) {
          // Continue the flow the user started before signing up.
          setTimeout(() => handleGenerateRef.current?.(), 800);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown upload error";
        toast.error(`Your saved photos could not be restored: ${message}`);
        // Keep storage intact so transient browser/network failures are retryable.
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
        const prepared = await prepareImageForUpload(file);
        await uploadMutation.mutateAsync({
          projectId: project.id,
          fileName: file.name,
          mimeType: prepared.mimeType,
          base64Data: dataUrlToBase64(prepared.dataUrl),
        });
        if (prepared.optimized) {
          toast.info(`${file.name} was optimized for a reliable high-quality upload`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown upload error";
        toast.error(`Failed to upload ${file.name}: ${message}`);
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
      ...(patch.aspectRatio
        ? { aspectRatio: patch.aspectRatio as "16:9" | "9:16" | "1:1" }
        : {}),
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

  const goToSection = (section: string) => {
    setActiveSection(section as DashSection);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCreateClick = () => {
    setActiveSection("create");
    setTimeout(
      () => document.getElementById("tour-tool")?.scrollIntoView({ behavior: "smooth" }),
      50,
    );
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
    aspectRatio: project?.aspectRatio ?? "16:9",
  };

  const firstImageUrl = toolImages[0]?.previewUrl ?? null;
  const jobs = jobsQuery.data ?? [];
  const readyCount = jobs.filter((j) => j.status === "ready").length;
  const processingCount = jobs.filter((j) => j.status === "processing").length;

  const sectionTitle =
    activeSection === "videos"
      ? "Your videos"
      : activeSection === "analytics"
        ? "Analytics"
        : `Welcome back${user?.name ? `, ${user.name.split(" ")[0]}` : ""}`;
  const sectionSubtitle =
    activeSection === "videos"
      ? "Every tour you've generated, ready to download and share."
      : activeSection === "analytics"
        ? "A quick look at your studio activity."
        : "Your studio is exactly as you left it — photos, order, and settings included.";

  const HistoryList = () => (
    <>
      {jobs.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
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
                  AI-directed tour · {job.resolution}
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
                    onClick={() => (subscribed ? handleDownload(job.id) : setPricingOpen(true))}
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
                      setActiveSection("create");
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
    </>
  );

  return (
    <div className="relative flex min-h-screen">
      {/* ===== Sidebar (persistent on desktop, drawer on mobile) ===== */}
      <DashboardSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        currentPlan={currentPlan}
        subscribed={subscribed}
        activeSection={activeSection}
        onNavigate={goToSection}
        onUpgradeClick={() => setPricingOpen(true)}
        onBillingClick={handleOpenBillingPortal}
      />

      {/* ===== Main column ===== */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/60 bg-background/80 px-3 backdrop-blur-xl lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-foreground hover:bg-muted"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <a href="/" className="flex items-center gap-2 font-display text-base text-foreground">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Clapperboard className="h-3.5 w-3.5" />
            </span>
            EstateTour
          </a>
          {subscribed ? (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-primary">
              <Crown className="h-4 w-4" />
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="btn-springy rounded-full px-2 text-primary"
              onClick={() => setPricingOpen(true)}
            >
              <Crown className="h-4 w-4" />
            </Button>
          )}
        </header>

        <main className="flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
          {/* Section header */}
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl text-foreground sm:text-3xl">{sectionTitle}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{sectionSubtitle}</p>
            </div>
            {/* Desktop plan actions */}
            <div className="hidden items-center gap-2 lg:flex">
              {subscribed ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground">
                    <Crown className="h-3.5 w-3.5 text-primary" />
                    {currentPlan
                      ? currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)
                      : "Active"}{" "}
                    plan
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="btn-springy rounded-full"
                    onClick={handleOpenBillingPortal}
                  >
                    <CreditCard className="mr-1.5 h-3.5 w-3.5" /> Billing
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  className="btn-springy rounded-full"
                  onClick={() => setPricingOpen(true)}
                >
                  <Crown className="mr-1.5 h-3.5 w-3.5" /> Upgrade
                </Button>
              )}
            </div>
          </div>

          {draftSyncing && (
            <div className="mb-6 flex items-center gap-3 rounded-2xl border border-ring/50 bg-accent/40 p-4 text-sm text-accent-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Restoring the photos and settings you prepared on the homepage…
            </div>
          )}

          {/* ===== CREATE SECTION ===== */}
          {activeSection === "create" && (
            <div className="grid gap-8 xl:grid-cols-[1fr_minmax(20rem,26rem)]">
              <section id="tour-tool" className="glass-panel rounded-3xl p-6 sm:p-8">
                <TourTool
                  images={toolImages}
                  settings={settings}
                  onFilesAdded={handleFilesAdded}
                  onReorder={handleReorder}
                  onDelete={handleDelete}
                  onSettingsChange={handleSettingsChange}
                  onGenerate={handleGenerate}
                  generateLabel="Generate Tour Video"
                  generating={
                    generateMutation.isPending ||
                    (theaterMode === "real" && activeJob?.status === "processing")
                  }
                  disabled={draftSyncing}
                />
              </section>

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
                      jobStatus={
                        theaterMode === "real"
                          ? ((activeJob?.status ?? "processing") as
                              | "processing"
                              | "ready"
                              | "failed")
                          : null
                      }
                      videoUrl={activeJob?.videoUrl ?? null}
                      errorMessage={activeJob?.errorMessage ?? null}
                      onFakeComplete={() => {
                        setTimeout(() => setPricingOpen(true), 900);
                      }}
                      onUnlockClick={() => setPricingOpen(true)}
                      onDownload={() => activeJobId && handleDownload(activeJobId)}
                    />
                  )}
                </section>

                {/* Recent videos preview */}
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <History className="h-4 w-4 text-primary" /> Recent videos
                    </h2>
                    {jobs.length > 0 && (
                      <button
                        onClick={() => goToSection("videos")}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        View all
                      </button>
                    )}
                  </div>
                  <HistoryList />
                </section>
              </div>
            </div>
          )}

          {/* ===== VIDEOS SECTION ===== */}
          {activeSection === "videos" && (
            <div className="max-w-3xl">
              <HistoryList />
            </div>
          )}

          {/* ===== ANALYTICS SECTION ===== */}
          {activeSection === "analytics" && (
            <div className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  { label: "Videos ready", value: readyCount, icon: BadgeCheck },
                  { label: "Rendering now", value: processingCount, icon: Sparkles },
                  { label: "Total generated", value: jobs.length, icon: TrendingUp },
                ].map((s) => (
                  <div key={s.label} className="glass-panel rounded-2xl p-5">
                    <div className="flex items-center justify-between">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent">
                        <s.icon className="h-5 w-5 text-primary" />
                      </span>
                      <span className="text-3xl font-semibold text-foreground">{s.value}</span>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">{s.label}</p>
                  </div>
                ))}
              </div>

              <div className="glass-panel rounded-2xl p-6">
                <h3 className="flex items-center gap-2 font-display text-lg text-foreground">
                  <BarChart3 className="h-5 w-5 text-primary" /> Plan usage
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {subscribed
                    ? "You're on a paid plan with unlimited cinematic generations."
                    : "You're on the free plan. Upgrade to unlock unlimited tours and 1080p exports."}
                </p>
                {!subscribed && (
                  <Button
                    size="sm"
                    className="btn-springy mt-4 rounded-full"
                    onClick={() => setPricingOpen(true)}
                  >
                    <Crown className="mr-1.5 h-3.5 w-3.5" /> See plans
                  </Button>
                )}
                <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" /> {readyCount} tours ready to
                    share
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" /> {serverImages.length} photos in
                    your current project
                  </li>
                </ul>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* ===== Mobile bottom nav ===== */}
      <DashboardBottomNav
        onMenuClick={() => setSidebarOpen(true)}
        onCreateClick={handleCreateClick}
        activeSection={activeSection}
        onNavigate={goToSection}
      />

      {/* ===== Pricing popup ===== */}
      <PricingModal open={pricingOpen} onOpenChange={setPricingOpen} onSelectPlan={handleSelectPlan} />
    </div>
  );
}
