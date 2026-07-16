import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { dataUrlToBase64, prepareImageForUpload } from "@/lib/imageUpload";
import TourTool, {
  type ToolImage,
  type ToolSettings,
} from "@/components/TourTool";
import GenerationTheater, {
  type TheaterMode,
} from "@/components/GenerationTheater";
import PricingModal from "@/components/PricingModal";
import PayAsYouGoCard from "@/components/PayAsYouGoCard";
import DashboardSidebar from "@/components/DashboardSidebar";
import DashboardBottomNav from "@/components/DashboardBottomNav";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  clearDraft,
  loadDraftWithImages,
  saveDraft,
} from "@/hooks/useToolDraft";
import { planForStoredId, type PlanId } from "@shared/plans";
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
  ImagePlus,
  Loader2,
  Menu,
  RefreshCw,
  Sparkles,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { TRPCClientError } from "@trpc/client";

type DashSection = "overview" | "create" | "videos" | "analytics";
type PendingAdditionalVideo = { sessionId: string; jobId?: number };

const PENDING_ADDITIONAL_VIDEO_KEY = "estatetour_pending_additional_video";
const RETRYABLE_QUERY_CODES = new Set([
  "INTERNAL_SERVER_ERROR",
  "TIMEOUT",
  "TOO_MANY_REQUESTS",
]);

function isRetryableStudioError(error: unknown): boolean {
  if (!(error instanceof TRPCClientError)) return false;
  const code = error.data?.code;
  // A tRPC error without structured data is a transport/parse failure while the
  // container is starting. Structured errors retry only when explicitly transient.
  return !code || RETRYABLE_QUERY_CODES.has(code);
}

function shouldRetryStudioQuery(failureCount: number, error: unknown): boolean {
  return failureCount < 6 && isRetryableStudioError(error);
}

function loadPendingAdditionalVideo(): PendingAdditionalVideo | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const checkoutSessionId =
    params.get("additional_video") === "success"
      ? params.get("session_id")
      : null;
  if (checkoutSessionId) return { sessionId: checkoutSessionId };

  try {
    const raw = localStorage.getItem(PENDING_ADDITIONAL_VIDEO_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingAdditionalVideo>;
    return typeof parsed.sessionId === "string"
      ? {
          sessionId: parsed.sessionId,
          ...(parsed.jobId ? { jobId: parsed.jobId } : {}),
        }
      : null;
  } catch {
    return null;
  }
}

function StatusBadge({
  status,
}: {
  status: "processing" | "ready" | "failed";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        status === "processing" && "bg-accent text-accent-foreground",
        status === "ready" && "bg-primary/15 text-primary",
        status === "failed" && "bg-destructive/10 text-destructive"
      )}
    >
      {status === "processing" && <Loader2 className="h-3 w-3 animate-spin" />}
      {status === "ready" && <BadgeCheck className="h-3 w-3" />}
      {status === "failed" && <XCircle className="h-3 w-3" />}
      {status}
    </span>
  );
}

function DashboardLoadError({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-16">
      <section className="w-full max-w-lg rounded-3xl border border-zinc-200 bg-card p-8 text-center shadow-[0_30px_90px_-50px_rgba(24,24,27,.5)]">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-950 text-white">
          <XCircle className="h-5 w-5" />
        </span>
        <h1 className="mt-6 font-display text-2xl text-foreground">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {message}
        </p>
        <Button
          type="button"
          className="btn-springy mt-6 rounded-full px-6"
          onClick={onRetry}
        >
          <RefreshCw className="mr-2 h-4 w-4" /> Try again
        </Button>
      </section>
    </main>
  );
}

export default function Dashboard() {
  const {
    user,
    loading: authLoading,
    isAuthenticated,
    error: authError,
    refresh: refreshAuth,
  } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();

  const [theaterMode, setTheaterMode] = useState<TheaterMode>("idle");
  const [fakePreviewComplete, setFakePreviewComplete] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [pendingAdditionalVideo, setPendingAdditionalVideo] =
    useState<PendingAdditionalVideo | null>(loadPendingAdditionalVideo);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [draftSyncing, setDraftSyncing] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [quickUploadDragOver, setQuickUploadDragOver] = useState(false);
  const [activeSection, setActiveSection] =
    useState<DashSection>("overview");
  const draftSyncedRef = useRef(false);
  const quickUploadInputRef = useRef<HTMLInputElement>(null);
  const pricingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stateQuery = trpc.tour.getState.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: shouldRetryStudioQuery,
    retryDelay: failureCount => Math.min(1000 * 2 ** failureCount, 10_000),
    refetchOnReconnect: true,
  });
  const jobsQuery = trpc.tour.listJobs.useQuery(undefined, {
    enabled: isAuthenticated,
    retry: shouldRetryStudioQuery,
    retryDelay: failureCount => Math.min(1000 * 2 ** failureCount, 10_000),
    refetchOnReconnect: true,
  });

  const project = stateQuery.data?.project;
  const serverImages = stateQuery.data?.images ?? [];
  const subscribed = stateQuery.data?.subscribed ?? false;
  const currentPlan = stateQuery.data?.plan ?? null;
  const entitlementQuery = trpc.tour.getPlanEntitlement.useQuery(undefined, {
    enabled: subscribed,
    retry: shouldRetryStudioQuery,
    retryDelay: failureCount => Math.min(1000 * 2 ** failureCount, 10_000),
    refetchOnReconnect: true,
  });
  const currentCatalogPlan = planForStoredId(currentPlan);
  const maxImages = entitlementQuery.data?.maxImages ?? 6;
  const maxDurationSeconds =
    entitlementQuery.data?.maxDurationSeconds ?? 15;
  const additionalVideoPriceUsd =
    entitlementQuery.data?.additionalVideoPriceUsd;
  const planEntitlementPending = subscribed && !entitlementQuery.data;
  const planEntitlementUnavailable =
    planEntitlementPending && !entitlementQuery.isFetching;

  const uploadMutation = trpc.tour.uploadImage.useMutation();
  const reorderMutation = trpc.tour.reorderImages.useMutation({
    onSuccess: () => utils.tour.getState.invalidate(),
    onError: e => {
      toast.error(e.message);
      utils.tour.getState.invalidate();
    },
  });
  const deleteMutation = trpc.tour.deleteImage.useMutation({
    // Optimistic: drop the image and re-compact order in the cache immediately
    // so the UI feels instant instead of waiting for the server + refetch.
    onMutate: async ({ imageId }) => {
      await utils.tour.getState.cancel();
      utils.tour.getState.setData(undefined, prev => {
        if (!prev) return prev;
        const images = prev.images
          .filter(img => img.id !== imageId)
          .map((img, idx) => ({ ...img, sequenceIndex: idx }));
        return { ...prev, images };
      });
    },
    onError: e => {
      // Roll back the optimistic removal by re-syncing with the server.
      toast.error(e.message);
      utils.tour.getState.invalidate();
    },
    onSettled: () => utils.tour.getState.invalidate(),
  });
  const settingsMutation = trpc.tour.updateSettings.useMutation({
    onSuccess: () => utils.tour.getState.invalidate(),
  });
  const generateMutation = trpc.tour.generate.useMutation();
  const downloadMutation = trpc.tour.getDownloadUrl.useMutation();

  // Redirect anonymous visitors to the sign-in page.
  useEffect(() => {
    if (!authLoading && user?.forcePasswordChange) {
      navigate("/change-password");
      return;
    }
    if (!authLoading && !isAuthenticated && !authError) {
      navigate("/login");
    }
  }, [
    authError,
    authLoading,
    isAuthenticated,
    navigate,
    user?.forcePasswordChange,
  ]);

  useEffect(() => {
    try {
      if (pendingAdditionalVideo) {
        localStorage.setItem(
          PENDING_ADDITIONAL_VIDEO_KEY,
          JSON.stringify(pendingAdditionalVideo)
        );
      } else {
        localStorage.removeItem(PENDING_ADDITIONAL_VIDEO_KEY);
      }
    } catch {
      // The paid session remains server-verifiable even if storage is blocked.
    }
  }, [pendingAdditionalVideo]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const additionalStatus = params.get("additional_video");
    if (additionalStatus === "success" && pendingAdditionalVideo) {
      toast.success(
        "Your additional video is ready. Click Generate Tour Video to use it."
      );
    } else if (additionalStatus === "cancelled") {
      toast.info("Additional-video checkout was cancelled");
    } else {
      return;
    }
    params.delete("additional_video");
    params.delete("session_id");
    const query = params.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`
    );
  }, [pendingAdditionalVideo]);

  // ===== One-time draft sync: restore homepage uploads/settings after signup =====
  useEffect(() => {
    if (!isAuthenticated || !project || draftSyncedRef.current || draftSyncing)
      return;

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
          toast.success(
            "Your photos and settings were restored from the homepage"
          );
        }
        if (shouldAutoGenerate) {
          // Continue the flow the user started before signing up.
          setTimeout(() => handleGenerateRef.current?.(), 800);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown upload error";
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
      refetchInterval: query => {
        const status = query.state.data?.status;
        return status === "processing" ? 5000 : false;
      },
    }
  );
  const activeJob = pollQuery.data ?? null;

  useEffect(() => {
    if (activeJob && activeJob.status !== "processing") {
      jobsQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob?.status]);

  useEffect(() => {
    if (!pendingAdditionalVideo?.jobId || !jobsQuery.data) return;
    const purchasedJob = jobsQuery.data.find(
      job => job.id === pendingAdditionalVideo.jobId
    );
    if (purchasedJob?.status === "ready") {
      setPendingAdditionalVideo(null);
    } else if (purchasedJob?.status === "failed") {
      // The server permanently keeps this paid Session attached to the failed
      // job so it cannot be submitted twice. Clear only the browser's pending
      // selection, allowing normal plan generations to continue.
      setPendingAdditionalVideo(null);
      toast.error(
        "Your paid additional video failed and was not resubmitted. Contact support for a refund or replacement."
      );
    }
  }, [jobsQuery.data, pendingAdditionalVideo]);

  useEffect(
    () => () => {
      if (pricingTimerRef.current) clearTimeout(pricingTimerRef.current);
    },
    []
  );

  const handleOpenPricing = useCallback(() => {
    if (pricingTimerRef.current) {
      clearTimeout(pricingTimerRef.current);
      pricingTimerRef.current = null;
    }
    setPricingOpen(true);
  }, []);

  const handlePricingOpenChange = useCallback((open: boolean) => {
    if (!open && pricingTimerRef.current) {
      clearTimeout(pricingTimerRef.current);
      pricingTimerRef.current = null;
    }
    setPricingOpen(open);
  }, []);

  const handleFakeComplete = useCallback(() => {
    setFakePreviewComplete(true);
    if (pricingTimerRef.current) clearTimeout(pricingTimerRef.current);
    pricingTimerRef.current = setTimeout(() => {
      setPricingOpen(true);
      pricingTimerRef.current = null;
    }, 900);
  }, []);

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
          toast.info(
            `${file.name} was optimized for a reliable high-quality upload`
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown upload error";
        toast.error(`Failed to upload ${file.name}: ${message}`);
      }
    }
    await utils.tour.getState.invalidate();
  };

  const handleQuickFiles = async (fileList: FileList | File[]) => {
    if (planEntitlementPending) {
      toast.error("Your plan limits are still loading. Please try again.");
      void entitlementQuery.refetch();
      return;
    }
    const files = Array.from(fileList).filter(file =>
      ["image/jpeg", "image/png", "image/webp"].includes(file.type)
    );
    if (files.length === 0) {
      toast.error("Please upload JPG, PNG, or WebP photos");
      return;
    }
    const room = maxImages - serverImages.length;
    if (room <= 0) {
      toast.error(`Maximum ${maxImages} photos per tour`);
      handleCreateClick();
      return;
    }
    if (files.length > room) {
      toast.warning(
        `Only ${room} more photo${room === 1 ? "" : "s"} can be added`
      );
    }

    setActiveSection("create");
    await handleFilesAdded(files.slice(0, room));
    window.requestAnimationFrame(() => {
      document
        .getElementById("tour-tool")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const handleReorder = (orderedIds: Array<string | number>) => {
    if (!project) return;
    const ids = orderedIds.map(id => Number(id));
    // Optimistic: update cache immediately.
    utils.tour.getState.setData(undefined, prev => {
      if (!prev) return prev;
      const byId = new Map(prev.images.map(i => [i.id, i]));
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
    utils.tour.getState.setData(undefined, prev =>
      prev ? { ...prev, project: { ...prev.project, ...patch } } : prev
    );
    settingsMutation.mutate({
      projectId: project.id,
      ...(patch.aspectRatio
        ? { aspectRatio: patch.aspectRatio as "16:9" | "9:16" | "1:1" }
        : {}),
    });
  };

  const revealOutputTheater = useCallback(() => {
    setActiveSection("create");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document
          .getElementById("output-theater")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!project) return;
    setActiveSection("create");
    const state = utils.tour.getState.getData();
    const imgs = state?.images ?? [];
    if (imgs.length === 0) {
      toast.error("Add at least one photo first");
      return;
    }

    if (!state?.subscribed) {
      // Keep the completed locked preview stable. Repeated clicks reopen pricing
      // instead of replaying the animation or exposing a stale real video.
      if (theaterMode === "fake" && fakePreviewComplete) {
        handleOpenPricing();
        return;
      }
      if (theaterMode === "fake") return;

      if (pricingTimerRef.current) {
        clearTimeout(pricingTimerRef.current);
        pricingTimerRef.current = null;
      }
      setFakePreviewComplete(false);
      setActiveJobId(null);
      setTheaterMode("fake");
      revealOutputTheater();
      return;
    }

    // SUBSCRIBER: real, costly generation.
    try {
      setTheaterMode("real");
      revealOutputTheater();
      const job = await generateMutation.mutateAsync({
        projectId: project.id,
        ...(pendingAdditionalVideo
          ? { additionalCheckoutSessionId: pendingAdditionalVideo.sessionId }
          : {}),
      });
      if (pendingAdditionalVideo) {
        if (job.status === "failed") {
          setPendingAdditionalVideo(null);
          toast.error(
            job.errorMessage ||
              "Your paid additional video failed. Contact support for a refund or replacement."
          );
        } else {
          setPendingAdditionalVideo({
            sessionId: pendingAdditionalVideo.sessionId,
            jobId: job.id,
          });
        }
      }
      setActiveJobId(job.id);
      jobsQuery.refetch();
    } catch (e) {
      setTheaterMode("idle");
      toast.error(
        e instanceof Error ? e.message : "Generation failed to start"
      );
      jobsQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fakePreviewComplete,
    pendingAdditionalVideo,
    project?.id,
    revealOutputTheater,
    theaterMode,
  ]);

  const handleGenerateRef = useRef<typeof handleGenerate | null>(null);
  useEffect(() => {
    handleGenerateRef.current = handleGenerate;
  }, [handleGenerate]);

  const handleSelectPlan = async (planId: PlanId) => {
    try {
      const res = await fetch(`/api/billing/checkout?plan=${planId}`, {
        method: "POST",
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error(
          data.error || "Could not start checkout — please try again"
        );
      }
    } catch {
      toast.error("Could not start checkout — please try again");
    }
  };

  // Continue an explicit pricing choice made on the public site after sign-up.
  useEffect(() => {
    if (!isAuthenticated) return;
    let selectedPlan: string | null = null;
    try {
      selectedPlan = localStorage.getItem("estatetour_selected_plan");
      if (selectedPlan) localStorage.removeItem("estatetour_selected_plan");
    } catch {
      return;
    }
    if (
      selectedPlan &&
      /^(starter|creator|studio)_(monthly|yearly)$/.test(selectedPlan)
    ) {
      void handleSelectPlan(selectedPlan as PlanId);
    }
    // Run once when authentication becomes available; the storage key is removed first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const handleBuyAdditionalVideo = async () => {
    if (pendingAdditionalVideo) {
      toast.info("Use your pending additional video before buying another one");
      return;
    }
    try {
      const response = await fetch("/api/billing/additional-video", {
        method: "POST",
      });
      const data = (await response.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.error(data.error || "Could not start additional-video checkout");
      }
    } catch {
      toast.error("Could not start additional-video checkout");
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
      () =>
        document
          .getElementById("tour-tool")
          ?.scrollIntoView({ behavior: "smooth" }),
      50
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
  if (authError) {
    return (
      <DashboardLoadError
        title="We couldn't verify your session"
        message="The dashboard could not reach the authentication service. Check your connection and try again."
        onRetry={() => void refreshAuth()}
      />
    );
  }
  if (!isAuthenticated) return null;
  if (stateQuery.isError && !stateQuery.data) {
    return (
      <DashboardLoadError
        title="We couldn't load your studio"
        message="The service may still be starting or the database may be unavailable. We'll keep retrying when the connection returns."
        onRetry={() => void stateQuery.refetch()}
      />
    );
  }

  const toolImages: ToolImage[] = serverImages.map(img => ({
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
  const jobsResolved = jobsQuery.data !== undefined;
  const readyCount = jobs.filter(j => j.status === "ready").length;
  const processingCount = jobs.filter(j => j.status === "processing").length;

  const sectionCopy: Record<DashSection, { title: string; subtitle: string }> = {
    overview: {
      title: `Welcome back${user?.name ? `, ${user.name.split(" ")[0]}` : ""}`,
      subtitle: "Your studio overview, recent videos, and current project.",
    },
    create: {
      title: "Create a tour",
      subtitle: "Upload, arrange, and turn listing photos into a cinematic video.",
    },
    videos: {
      title: "Your videos",
      subtitle: "Every tour you've generated, ready to download and share.",
    },
    analytics: {
      title: "Analytics",
      subtitle: "A quick look at your studio activity.",
    },
  };
  const { title: sectionTitle, subtitle: sectionSubtitle } =
    sectionCopy[activeSection];

  const HistoryList = ({ limit }: { limit?: number }) => {
    if (jobsQuery.isLoading) {
      return (
        <div className="space-y-3" aria-label="Loading videos">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      );
    }
    if (jobsQuery.isError && !jobsQuery.data) {
      return (
        <div className="rounded-2xl border border-border bg-card/50 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Your video history could not be loaded.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="btn-springy mt-3 rounded-full"
            onClick={() => void jobsQuery.refetch()}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Try again
          </Button>
        </div>
      );
    }

    const visibleJobs = typeof limit === "number" ? jobs.slice(0, limit) : jobs;

    return (
    <>
      {jobs.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
          No videos yet — your generation history will live here.
        </div>
      ) : (
        <ul className="space-y-3">
          {visibleJobs.map(job => (
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
                  <StatusBadge
                    status={job.status as "processing" | "ready" | "failed"}
                  />
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-1.5">
                {job.status === "ready" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="btn-springy h-7 rounded-full bg-card px-2.5 text-xs"
                    onClick={() =>
                      subscribed ? handleDownload(job.id) : handleOpenPricing()
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
                      setActiveSection("create");
                    }}
                  >
                    <RefreshCw className="mr-1 h-3 w-3" /> View
                  </Button>
                )}
                {job.status === "failed" &&
                  (job.additionalVideo ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="btn-springy h-7 rounded-full px-2.5 text-xs"
                      onClick={() =>
                        toast.error(
                          "This paid additional video was not resubmitted. Contact support for a refund or replacement."
                        )
                      }
                    >
                      <CreditCard className="mr-1 h-3 w-3" /> Support
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="btn-springy h-7 rounded-full px-2.5 text-xs"
                      onClick={handleGenerate}
                    >
                      <RefreshCw className="mr-1 h-3 w-3" /> Retry
                    </Button>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
    );
  };

  return (
    <div className="relative flex min-h-screen bg-background">
      {/* ===== Sidebar (persistent on desktop, drawer on mobile) ===== */}
      <DashboardSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        currentPlan={currentPlan}
        subscribed={subscribed}
        activeSection={activeSection}
        onNavigate={goToSection}
        onUpgradeClick={handleOpenPricing}
        onBuyAdditionalVideo={handleBuyAdditionalVideo}
        onBillingClick={handleOpenBillingPortal}
        additionalVideoPriceUsd={additionalVideoPriceUsd}
      />

      {/* ===== Main column ===== */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-zinc-200 bg-white/90 px-3 backdrop-blur-xl lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-foreground hover:bg-muted"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <a
            href="/"
            className="flex items-center gap-2 font-display text-base text-foreground"
          >
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
              onClick={handleOpenPricing}
            >
              <Crown className="h-4 w-4" />
            </Button>
          )}
        </header>

        <main className="flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-8">
          {/* Section header */}
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl text-foreground sm:text-3xl">
                {sectionTitle}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {sectionSubtitle}
              </p>
            </div>
            {/* Desktop plan actions */}
            <div className="hidden items-center gap-2 lg:flex">
              {subscribed ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground">
                    <Crown className="h-3.5 w-3.5 text-primary" />
                    {currentCatalogPlan
                      ? `${currentCatalogPlan.name} ${currentCatalogPlan.interval === "year" ? "Yearly" : "Monthly"}`
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
                  onClick={handleOpenPricing}
                >
                  <Crown className="mr-1.5 h-3.5 w-3.5" /> Upgrade
                </Button>
              )}
            </div>
          </div>

          {stateQuery.isError && stateQuery.data && (
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-300 bg-card p-4 text-sm text-muted-foreground">
              <span>
                Showing your saved studio data while we reconnect to the server.
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="btn-springy rounded-full"
                onClick={() => void stateQuery.refetch()}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Reconnect
              </Button>
            </div>
          )}

          {draftSyncing && (
            <div className="mb-6 flex items-center gap-3 rounded-2xl border border-ring/50 bg-accent/40 p-4 text-sm text-accent-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Restoring the photos and settings you prepared on the homepage…
            </div>
          )}

          {/* ===== OVERVIEW SECTION ===== */}
          {activeSection === "overview" && (
            <div className="space-y-8">
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  {
                    label: "Project photos",
                    value: serverImages.length,
                    icon: Clapperboard,
                  },
                  {
                    label: "Videos ready",
                    value: jobsResolved ? readyCount : "—",
                    icon: BadgeCheck,
                  },
                  {
                    label: "Total videos",
                    value: jobsResolved ? jobs.length : "—",
                    icon: Film,
                  },
                ].map(item => (
                  <div key={item.label} className="glass-panel rounded-2xl p-5">
                    <div className="flex items-center justify-between">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent">
                        <item.icon className="h-5 w-5 text-primary" />
                      </span>
                      <span className="text-3xl font-semibold text-foreground">
                        {item.value}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">
                      {item.label}
                    </p>
                  </div>
                ))}
              </div>

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
                <section className="glass-panel rounded-3xl p-6 sm:p-8">
                  <span className="inline-flex items-center gap-2 rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-white">
                    <Sparkles className="h-3.5 w-3.5" /> Current project
                  </span>
                  <h2 className="mt-5 font-display text-2xl text-foreground">
                    Continue building your property tour
                  </h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                    Your project has {serverImages.length} photo
                    {serverImages.length === 1 ? "" : "s"}. Add more images,
                    arrange the sequence, and generate your next video.
                  </p>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label="Quick upload property photos"
                    onClick={() => quickUploadInputRef.current?.click()}
                    onKeyDown={event => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        quickUploadInputRef.current?.click();
                      }
                    }}
                    onDragOver={event => {
                      event.preventDefault();
                      setQuickUploadDragOver(true);
                    }}
                    onDragLeave={() => setQuickUploadDragOver(false)}
                    onDrop={event => {
                      event.preventDefault();
                      setQuickUploadDragOver(false);
                      void handleQuickFiles(event.dataTransfer.files);
                    }}
                    className={cn(
                      "mt-6 cursor-pointer rounded-2xl border-2 border-dashed p-5 text-center transition-all",
                      quickUploadDragOver
                        ? "border-zinc-950 bg-zinc-100"
                        : "border-zinc-300 bg-white/65 hover:border-zinc-500 hover:bg-white"
                    )}
                  >
                    <input
                      ref={quickUploadInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      className="hidden"
                      onChange={event => {
                        if (event.target.files) {
                          void handleQuickFiles(event.target.files);
                        }
                        event.target.value = "";
                      }}
                    />
                    <ImagePlus className="mx-auto h-6 w-6 text-zinc-700" />
                    <p className="mt-2 text-sm font-semibold text-foreground">
                      Drop images here or click to upload
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {planEntitlementPending
                        ? "Plan upload limit is loading securely"
                        : `Up to ${maxImages} photos · uploads open in Create Tour`}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="btn-springy mt-3 rounded-full px-4"
                    onClick={handleCreateClick}
                  >
                    <Clapperboard className="mr-2 h-4 w-4" /> Open tour builder
                  </Button>
                </section>

                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <History className="h-4 w-4 text-primary" /> Recent videos
                    </h2>
                    {jobs.length > 0 && (
                      <button
                        type="button"
                        onClick={() => goToSection("videos")}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        View all
                      </button>
                    )}
                  </div>
                  <HistoryList limit={3} />
                </section>
              </div>
              <PayAsYouGoCard
                currentPlan={currentPlan}
                subscribed={subscribed}
                additionalVideoPriceUsd={additionalVideoPriceUsd}
                onAction={
                  subscribed ? handleBuyAdditionalVideo : handleOpenPricing
                }
              />
            </div>
          )}

          {/* ===== CREATE SECTION ===== */}
          {activeSection === "create" && (
            <div className="grid gap-8 xl:grid-cols-[1fr_minmax(20rem,26rem)]">
              <section
                id="tour-tool"
                className="glass-panel rounded-3xl border-zinc-200 bg-white p-6 sm:p-8"
              >
                {planEntitlementPending ? (
                  <div className="flex min-h-72 flex-col items-center justify-center text-center">
                    {planEntitlementUnavailable ? (
                      <RefreshCw className="h-7 w-7 text-muted-foreground" />
                    ) : (
                      <Loader2 className="h-7 w-7 animate-spin text-primary" />
                    )}
                    <h2 className="mt-4 font-display text-xl text-foreground">
                      Verifying your plan benefits
                    </h2>
                    <p className="mt-2 max-w-md text-sm text-muted-foreground">
                      Your exact image, duration, and additional-video limits load
                      separately so the rest of your dashboard stays available.
                    </p>
                    {entitlementQuery.isError && (
                      <Button
                        type="button"
                        variant="outline"
                        className="btn-springy mt-4 rounded-full"
                        onClick={() => void entitlementQuery.refetch()}
                      >
                        <RefreshCw className="mr-2 h-4 w-4" /> Try again
                      </Button>
                    )}
                  </div>
                ) : (
                  <TourTool
                    images={toolImages}
                    settings={settings}
                    onFilesAdded={handleFilesAdded}
                    onReorder={handleReorder}
                    onDelete={handleDelete}
                    onSettingsChange={handleSettingsChange}
                    onGenerate={handleGenerate}
                    generateLabel="Generate Tour Video"
                    maxImages={maxImages}
                    maxDurationSeconds={maxDurationSeconds}
                    generating={
                      generateMutation.isPending ||
                      (theaterMode === "real" &&
                        activeJob?.status === "processing")
                    }
                    disabled={draftSyncing}
                  />
                )}
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
                      videoUrl={
                        theaterMode === "real" && subscribed
                          ? (activeJob?.videoUrl ?? null)
                          : null
                      }
                      errorMessage={activeJob?.errorMessage ?? null}
                      onFakeComplete={handleFakeComplete}
                      fakeComplete={fakePreviewComplete}
                      canPlayVideo={subscribed}
                      onUnlockClick={handleOpenPricing}
                      onDownload={() =>
                        activeJobId && handleDownload(activeJobId)
                      }
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
                        type="button"
                        onClick={() => goToSection("videos")}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        View all
                      </button>
                    )}
                  </div>
                  <HistoryList limit={3} />
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
                  {
                    label: "Videos ready",
                    value: jobsResolved ? readyCount : "—",
                    icon: BadgeCheck,
                  },
                  {
                    label: "Rendering now",
                    value: jobsResolved ? processingCount : "—",
                    icon: Sparkles,
                  },
                  {
                    label: "Total generated",
                    value: jobsResolved ? jobs.length : "—",
                    icon: TrendingUp,
                  },
                ].map(s => (
                  <div key={s.label} className="glass-panel rounded-2xl p-5">
                    <div className="flex items-center justify-between">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent">
                        <s.icon className="h-5 w-5 text-primary" />
                      </span>
                      <span className="text-3xl font-semibold text-foreground">
                        {s.value}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">
                      {s.label}
                    </p>
                  </div>
                ))}
              </div>

              <div className="glass-panel rounded-2xl p-6">
                <h3 className="flex items-center gap-2 font-display text-lg text-foreground">
                  <BarChart3 className="h-5 w-5 text-primary" /> Plan usage
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {subscribed
                    ? "Your paid plan includes cinematic 1080p generations without watermarks."
                    : "You're on the free plan. Upgrade for 1080p cinematic tours without watermarks."}
                </p>
                {subscribed ? (
                  <Button
                    size="sm"
                    className="btn-springy mt-4 rounded-full"
                    onClick={handleBuyAdditionalVideo}
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Buy additional
                    video
                    {additionalVideoPriceUsd
                      ? ` · $${additionalVideoPriceUsd}`
                      : ""}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="btn-springy mt-4 rounded-full"
                    onClick={handleOpenPricing}
                  >
                    <Crown className="mr-1.5 h-3.5 w-3.5" /> See plans
                  </Button>
                )}
                <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" />{" "}
                    {jobsResolved ? readyCount : "—"} tours ready to share
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" />{" "}
                    {serverImages.length} photos in your current project
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
      <PricingModal
        open={pricingOpen}
        onOpenChange={handlePricingOpenChange}
        onSelectPlan={handleSelectPlan}
        promoUserKey={user?.id ?? "guest"}
        currentPlan={currentPlan}
        subscribed={subscribed}
        additionalVideoPriceUsd={additionalVideoPriceUsd}
        onBuyAdditionalVideo={handleBuyAdditionalVideo}
      />
    </div>
  );
}
