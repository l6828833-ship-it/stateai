import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import PricingCards from "@/components/PricingCards";
import PayAsYouGoCard from "@/components/PayAsYouGoCard";
import TourTool, {
  type ToolImage,
  type ToolSettings,
} from "@/components/TourTool";
import { Button } from "@/components/ui/button";
import { saveDraft, useToolDraft, type DraftImage } from "@/hooks/useToolDraft";
import { prepareImageForUpload } from "@/lib/imageUpload";
import type { PlanId } from "@shared/plans";
import {
  ArrowRight,
  Brain,
  CheckCircle2,
  Clapperboard,
  Clock,
  Download,
  Eye,
  Layers,
  ListOrdered,
  Menu,
  Play,
  Sparkles,
  Star,
  TrendingUp,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const HERO_IMG_1 = "/manus-storage/hero-living_b05098b0.jpg";
const HERO_IMG_2 = "/manus-storage/hero-kitchen2_815b2217.jpg";
const HERO_IMG_3 = "/manus-storage/hero-aerial_18f0bf6c.jpg";

/** Scroll-reveal helper */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".reveal-on-scroll");
    const io = new IntersectionObserver(
      entries => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);
}

const HERO_ROOMS = [
  { src: HERO_IMG_1, label: "Living room" },
  { src: HERO_IMG_2, label: "Kitchen" },
  { src: HERO_IMG_3, label: "Aerial view" },
];

/** Hero preview card that crossfades between room shots with ken-burns motion */
function HeroPreview() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setFrame(f => (f + 1) % HERO_ROOMS.length),
      4500
    );
    return () => clearInterval(t);
  }, []);
  const current = HERO_ROOMS[frame];
  const next = HERO_ROOMS[(frame + 1) % HERO_ROOMS.length];

  return (
    <div className="relative">
      {/* Floating "render time" chip */}
      <div className="glass-panel animate-chip-float absolute -left-3 -top-5 z-20 flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium text-foreground shadow-lg sm:-left-6">
        <span className="relative flex h-2 w-2">
          <span className="animate-dot-pulse absolute inline-flex h-2 w-2 rounded-full bg-primary" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        Rendered in ~2 minutes
      </div>

      {/* Floating "4K ready" chip */}
      <div
        className="glass-panel animate-float-soft absolute -bottom-4 -right-2 z-20 flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium text-foreground shadow-lg sm:-right-6"
        style={{ animationDelay: "1.2s" }}
      >
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        Cinematic 1080p
      </div>

      <div className="glass-panel relative overflow-hidden rounded-3xl p-2 sm:p-3">
        <div className="relative aspect-video overflow-hidden rounded-2xl bg-muted">
          {HERO_ROOMS.map((room, i) => (
            <img
              key={room.src}
              src={room.src}
              alt={`AI house tour preview — ${room.label}`}
              className={cn(
                "absolute inset-0 h-full w-full object-cover transition-opacity duration-1000",
                i === frame ? "opacity-100 animate-ken-burns" : "opacity-0"
              )}
            />
          ))}

          {/* Top overlay: live recording badge */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3">
            <span className="flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-100" />
              AI Tour Preview
            </span>
            <span className="flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
              <Play className="h-3 w-3 fill-white" /> Auto
            </span>
          </div>

          {/* Bottom overlay: room transition caption + scrubber */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 pt-8">
            <div className="mb-2 flex items-center justify-between text-[11px] font-medium text-white">
              <span className="flex items-center gap-1.5">
                <Clapperboard className="h-3.5 w-3.5" />
                {
                  current.label
                } <ArrowRight className="h-3 w-3 opacity-70" /> {next.label}
              </span>
              <span className="flex gap-1">
                {HERO_ROOMS.map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-1.5 rounded-full transition-all duration-500",
                      i === frame ? "w-5 bg-white" : "w-1.5 bg-white/50"
                    )}
                  />
                ))}
              </span>
            </div>
            {/* Scrub track */}
            <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/25">
              <div className="animate-scrub absolute inset-y-0 w-2/5 rounded-full bg-white" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { isAuthenticated, user } = useAuth();
  const [, navigate] = useLocation();
  const { draft, update, setDraft } = useToolDraft();
  const heroRef = useRef<HTMLDivElement>(null);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useReveal();

  // Header turns from transparent (over hero) to a frosted bar once the user scrolls.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Smooth-scroll to a section (or the top for "Home") and close the mobile menu.
  const scrollToSection = useCallback((id: string) => {
    setMobileMenuOpen(false);
    if (id === "top") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Cursor parallax on hero
  const onHeroMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = heroRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setParallax({ x, y });
  }, []);

  // Returning from the sign-up gate: continue to the dashboard tool.
  useEffect(() => {
    if (isAuthenticated && draft.pendingGenerate) {
      navigate("/dashboard");
    }
  }, [isAuthenticated, draft.pendingGenerate, navigate]);

  const toolImages: ToolImage[] = draft.images.map(img => ({
    id: img.cid,
    previewUrl: img.dataUrl,
    fileName: img.fileName,
    roomTag: img.roomTag,
  }));

  const settings: ToolSettings = {
    aspectRatio: draft.aspectRatio,
  };

  const handleFilesAdded = async (files: File[]) => {
    const newImages: DraftImage[] = [];
    for (const file of files) {
      try {
        const prepared = await prepareImageForUpload(file);
        newImages.push({
          cid: `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          fileName: file.name,
          mimeType: prepared.mimeType,
          dataUrl: prepared.dataUrl,
        });
        if (prepared.optimized) {
          toast.info(
            `${file.name} was optimized for a reliable high-quality upload`
          );
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "The image could not be read";
        toast.error(`${file.name}: ${message}`);
      }
    }
    if (newImages.length > 0) {
      setDraft(current => ({
        ...current,
        images: [...current.images, ...newImages],
      }));
      toast.success(
        `${newImages.length} photo${newImages.length > 1 ? "s" : ""} added to your tour`
      );
    }
  };

  const handleReorder = (orderedIds: Array<string | number>) => {
    setDraft(current => {
      const byId = new Map(current.images.map(image => [image.cid, image]));
      const reordered = orderedIds
        .map(id => byId.get(String(id)))
        .filter((image): image is DraftImage => Boolean(image));
      return { ...current, images: reordered };
    });
  };

  const handleDelete = (id: string | number) => {
    setDraft(current => ({
      ...current,
      images: current.images.filter(image => image.cid !== String(id)),
    }));
  };

  const handleSettingsChange = (patch: Partial<ToolSettings>) => {
    update(patch);
  };

  const handleGenerate = async () => {
    if (draft.images.length === 0) {
      toast.error("Add at least one photo first");
      return;
    }
    // Persist the exact draft before navigating through sign-up.
    const pendingDraft = { ...draft, pendingGenerate: true };
    update({ pendingGenerate: true });
    try {
      await saveDraft(pendingDraft);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Browser storage is unavailable";
      toast.error(`Your photos could not be saved before sign-up: ${message}`);
      return;
    }
    if (isAuthenticated) {
      navigate("/dashboard");
    } else {
      toast(
        "Create a free account to generate — your photos & settings are saved."
      );
      setTimeout(() => navigate("/signup"), 600);
    }
  };

  const scrollToTool = () => {
    document
      .getElementById("tour-tool")
      ?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      {/* ===== Nav ===== */}
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 transition-all duration-300",
          scrolled
            ? "border-b border-zinc-200/80 bg-white/85 shadow-[0_12px_35px_rgba(24,24,27,0.08)] backdrop-blur-xl"
            : "border-b border-transparent bg-transparent"
        )}
      >
        <div
          className={cn(
            "container flex items-center justify-between transition-all duration-300",
            scrolled ? "h-14" : "h-16"
          )}
        >
          {/* Logo */}
          <button
            onClick={() => scrollToSection("top")}
            className="flex items-center gap-2 font-display text-lg text-foreground"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-zinc-950 text-white shadow-lg shadow-zinc-950/15">
              <Clapperboard className="h-4 w-4" />
            </span>
            EstateTour AI
          </button>

          {/* Center menu (desktop) */}
          <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 md:flex">
            {[
              { label: "Home", id: "top" },
              { label: "AI Real Estate", id: "features" },
              { label: "How it works", id: "how-it-works" },
              { label: "Pricing", id: "pricing" },
            ].map(item => (
              <button
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className="rounded-full px-3.5 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950"
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Right actions */}
          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <Button
                variant="default"
                className="btn-springy rounded-full bg-zinc-950 text-white hover:bg-zinc-800"
                onClick={() => navigate("/dashboard")}
              >
                Dashboard <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  className="btn-springy hidden rounded-full text-foreground/80 sm:inline-flex"
                  onClick={() => navigate("/login")}
                >
                  Log in
                </Button>
                <Button
                  className="btn-springy rounded-full bg-zinc-950 text-white hover:bg-zinc-800"
                  onClick={scrollToTool}
                >
                  Try it free
                </Button>
              </>
            )}
            {/* Mobile menu toggle */}
            <button
              onClick={() => setMobileMenuOpen(o => !o)}
              className="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-accent/70 md:hidden"
              aria-label="Toggle menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile dropdown menu */}
        {mobileMenuOpen && (
          <div className="glass-panel mx-3 mb-2 rounded-2xl border border-zinc-200 p-2 md:hidden">
            {[
              { label: "Home", id: "top" },
              { label: "AI Real Estate", id: "features" },
              { label: "How it works", id: "how-it-works" },
              { label: "Pricing", id: "pricing" },
            ].map(item => (
              <button
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className="block w-full rounded-xl px-4 py-2.5 text-left text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-950"
              >
                {item.label}
              </button>
            ))}
            {!isAuthenticated && (
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  navigate("/login");
                }}
                className="block w-full rounded-xl px-4 py-2.5 text-left text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-100"
              >
                Log in
              </button>
            )}
          </div>
        )}
      </header>

      {/* ===== Hero ===== */}
      <section
        ref={heroRef}
        onMouseMove={onHeroMouseMove}
        className="relative flex min-h-screen items-center bg-[#f7f7f8] pt-24 pb-16"
      >
        {/* Drifting gradient blobs */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="animate-blob-1 absolute -left-32 -top-24 h-[34rem] w-[34rem] rounded-full opacity-60 blur-3xl"
            style={{
              background:
                "radial-gradient(circle, rgba(255,255,255,.96) 0%, rgba(212,212,216,.55) 60%, transparent 75%)",
              translate: `${parallax.x * -18}px ${parallax.y * -18}px`,
            }}
          />
          <div
            className="animate-blob-2 absolute right-[-10rem] top-[15%] h-[30rem] w-[30rem] rounded-full opacity-50 blur-3xl"
            style={{
              background:
                "radial-gradient(circle, rgba(161,161,170,.55) 0%, rgba(228,228,231,.48) 55%, transparent 75%)",
              translate: `${parallax.x * -26}px ${parallax.y * -26}px`,
            }}
          />
          <div
            className="animate-blob-3 absolute bottom-[-8rem] left-[30%] h-[26rem] w-[26rem] rounded-full opacity-40 blur-3xl"
            style={{
              background:
                "radial-gradient(circle, rgba(244,244,245,.9) 0%, rgba(161,161,170,.35) 60%, transparent 78%)",
              translate: `${parallax.x * -12}px ${parallax.y * -12}px`,
            }}
          />
        </div>

        <div className="container relative grid items-center gap-12 lg:grid-cols-2">
          <div>
            <span className="animate-fade-up inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-accent/80 px-3 py-1 text-xs font-medium text-accent-foreground backdrop-blur-sm">
              <span className="relative flex h-2 w-2">
                <span className="animate-dot-pulse absolute inline-flex h-2 w-2 rounded-full bg-primary" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              AI video for real estate
            </span>
            <h1 className="animate-fade-up-delay-1 mt-5 font-display text-4xl leading-[1.08] text-foreground sm:text-5xl lg:text-[3.6rem]">
              Photos in.
              <br />A{" "}
              <span className="animate-text-sheen bg-gradient-to-r from-zinc-950 via-zinc-500 to-zinc-950 bg-clip-text text-transparent">
                cinematic tour
              </span>{" "}
              out.
            </h1>
            <p className="animate-fade-up-delay-2 mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Upload the listing photos you already have. Our AI walks buyers
              through every room and lifts them over the rooftop — a
              broadcast-quality tour video in minutes, not days. No drone pilot,
              no film crew, no editing suite.
            </p>
            <div className="animate-fade-up-delay-3 mt-8 flex flex-wrap items-center gap-4">
              <Button
                size="lg"
                onClick={scrollToTool}
                className="btn-springy rounded-full bg-zinc-950 px-8 py-6 text-base text-white shadow-xl shadow-zinc-950/20 hover:bg-zinc-800"
              >
                Create my tour video <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
              <button
                onClick={() =>
                  document
                    .getElementById("how-it-works")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
                className="btn-springy group inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium text-foreground/80 transition-colors hover:text-primary"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent group-hover:bg-primary/15">
                  <Play className="h-3.5 w-3.5 fill-primary text-primary" />
                </span>
                See how it works
              </button>
            </div>

            {/* Trust indicators */}
            <div className="animate-fade-up-delay-3 mt-9 flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="flex items-center gap-2">
                <div className="flex -space-x-2">
                  {["#18181b", "#3f3f46", "#71717a", "#a1a1aa"].map((c, i) => (
                    <span
                      key={i}
                      className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background text-[10px] font-semibold text-white"
                      style={{ background: c }}
                    >
                      {["S", "M", "J", "K"][i]}
                    </span>
                  ))}
                </div>
                <div className="flex flex-col leading-tight">
                  <span className="flex items-center gap-1 text-sm font-medium text-foreground">
                    <Star className="h-3.5 w-3.5 fill-primary text-primary" />{" "}
                    4.9/5
                  </span>
                  <span className="text-xs text-muted-foreground">
                    from 600+ agents
                  </span>
                </div>
              </div>
              <div className="hidden h-8 w-px bg-border sm:block" />
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                Free to try · no card required
              </div>
            </div>
          </div>

          <div
            className="animate-fade-up-delay-2"
            style={{ translate: `${parallax.x * 10}px ${parallax.y * 10}px` }}
          >
            <HeroPreview />
          </div>
        </div>
      </section>

      {/* ===== Interactive tool, intentionally directly below the hero ===== */}
      <section
        id="tour-tool"
        className="relative scroll-mt-20 border-y border-zinc-200/70 bg-white/55 py-20"
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute left-1/2 top-0 h-72 w-[44rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
        </div>
        <div className="container relative">
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
            <span className="rounded-full bg-zinc-950 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white">
              Build your first tour
            </span>
            <h2 className="mt-4 font-display text-3xl text-foreground sm:text-4xl">
              Your AI video studio, ready now
            </h2>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              Add up to six photos, arrange the story, and choose any social
              ratio. Your exact draft follows you through sign-up.
            </p>
          </div>
          <div className="reveal-on-scroll mx-auto mt-10 max-w-4xl">
            <div className="rounded-[2rem] border border-zinc-200 bg-white/90 p-3 shadow-[0_30px_100px_-45px_rgba(24,24,27,.45)] sm:p-5">
              <div className="rounded-[1.5rem] border border-zinc-200 bg-white p-5 sm:p-8">
                <TourTool
                  images={toolImages}
                  settings={settings}
                  onFilesAdded={handleFilesAdded}
                  onReorder={handleReorder}
                  onDelete={handleDelete}
                  onSettingsChange={handleSettingsChange}
                  onGenerate={handleGenerate}
                  generateLabel="Generate Tour Video"
                />
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-zinc-500">
              {[
                "No card required",
                "1080p high quality",
                "Up to 15 seconds",
                "Draft saved securely",
              ].map(item => (
                <span key={item} className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-zinc-900" /> {item}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== Features ===== */}
      <section id="features" className="relative scroll-mt-24 py-24">
        <div className="container">
          <div className="reveal-on-scroll mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl text-foreground sm:text-4xl">
              Every listing deserves a premiere
            </h2>
            <p className="mt-4 text-muted-foreground">
              Three tour styles, one intelligent pipeline. Your photos stay
              exactly as they are — the camera is the only thing that moves.
            </p>
          </div>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {[
              {
                icon: Layers,
                title: "Photos in, film out",
                body: "Drop in your listing photos in the order you want the tour to flow. Our pipeline preserves that exact sequence — every room appears exactly where you placed it.",
              },
              {
                icon: Brain,
                title: "A director in the machine",
                body: "Behind the scenes, AI studies each room's geometry and lighting to choose the most flattering camera move — push-ins, pans, orbits, and aerial reveals.",
              },
              {
                icon: Download,
                title: "Ready for every channel",
                body: "Export in widescreen for YouTube, vertical for Reels and TikTok, or square for feeds — up to crisp 1080p on every paid plan.",
              },
            ].map((f, i) => (
              <div
                key={f.title}
                className="reveal-on-scroll glass-panel soft-card-hover rounded-2xl p-7"
                style={{ transitionDelay: `${i * 150}ms` }}
              >
                <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent">
                  <f.icon className="h-5 w-5 text-primary" strokeWidth={1.6} />
                </span>
                <h3 className="font-display text-lg text-foreground">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Pricing ===== */}
      <section
        id="pricing"
        className="relative scroll-mt-24 overflow-hidden py-24"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(24,24,27,.08),transparent_46%)]" />
        <div className="container relative">
          <div className="reveal-on-scroll mx-auto max-w-2xl text-center">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
              Pricing that scales
            </span>
            <h2 className="mt-3 font-display text-3xl text-foreground sm:text-4xl">
              One studio. Three ways to grow.
            </h2>
            <p className="mt-3 text-muted-foreground">
              Switch between monthly and yearly billing. Every tier includes
              1080p video, all aspect ratios, viral effects, and no watermark.
            </p>
          </div>
          <PricingCards
            className="reveal-on-scroll mx-auto mt-12 max-w-6xl"
            promoUserKey={user?.id ?? "guest"}
            onSelectPlan={async (planId: PlanId) => {
              if (!isAuthenticated) {
                try {
                  localStorage.setItem("estatetour_selected_plan", planId);
                } catch {}
                navigate("/signup");
                return;
              }
              try {
                const response = await fetch(
                  `/api/billing/checkout?plan=${planId}`,
                  { method: "POST" }
                );
                const data = (await response.json()) as {
                  url?: string;
                  error?: string;
                };
                if (data.url) window.location.href = data.url;
                else toast.error(data.error || "Could not start checkout");
              } catch {
                toast.error(
                  "Could not start checkout. Check your connection and try again."
                );
              }
            }}
          />
          <PayAsYouGoCard
            className="reveal-on-scroll mx-auto mt-6 max-w-6xl"
            deferRateToDashboard={isAuthenticated}
            onAction={() => {
              if (!isAuthenticated) {
                try {
                  localStorage.setItem(
                    "estatetour_buy_one_video_after_auth",
                    "true"
                  );
                } catch {}
                navigate("/signup");
                return;
              }
              navigate("/dashboard");
            }}
            actionLabel={
              isAuthenticated
                ? "View your rate in Dashboard"
                : "Sign up and buy · $17"
            }
          />
        </div>
      </section>

      {/* ===== How it works ===== */}
      <section id="how-it-works" className="relative scroll-mt-24 py-24">
        <div className="container">
          <div className="reveal-on-scroll mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl text-foreground sm:text-4xl">
              From photos to premiere in five steps
            </h2>
          </div>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[
              {
                icon: Upload,
                label: "Upload",
                body: "Add your listing photos",
              },
              {
                icon: ListOrdered,
                label: "Confirm order",
                body: "Drag rooms into tour sequence",
              },
              {
                icon: Wand2,
                label: "Generate",
                body: "AI films your walkthrough",
              },
              { icon: Eye, label: "Review", body: "Watch your cinematic tour" },
              {
                icon: Download,
                label: "Export",
                body: "Download & share anywhere",
              },
            ].map((s, i) => (
              <div
                key={s.label}
                className="reveal-on-scroll relative rounded-2xl border border-border bg-card/70 p-5 text-center soft-card-hover"
                style={{ transitionDelay: `${i * 120}ms` }}
              >
                <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent">
                  <s.icon className="h-4 w-4 text-primary" strokeWidth={1.6} />
                </span>
                <span className="absolute left-3 top-3 text-xs font-semibold text-primary/60">
                  {i + 1}
                </span>
                <p className="font-medium text-sm text-foreground">{s.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{s.body}</p>
                {i < 4 && (
                  <ArrowRight className="absolute -right-3 top-1/2 hidden h-4 w-4 -translate-y-1/2 text-primary/50 lg:block" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Use Cases ===== */}
      <section className="relative py-24">
        <div className="container">
          <div className="reveal-on-scroll mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl text-foreground sm:text-4xl">
              Perfect for every property type
            </h2>
            <p className="mt-3 text-muted-foreground">
              Whether it's a cozy apartment, sprawling estate, or commercial
              space, EstateTour AI adapts to your listing.
            </p>
          </div>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {[
              {
                icon: TrendingUp,
                title: "Luxury Estates",
                body: "Showcase grand foyers, infinity pools, and panoramic views with cinematic drone-style reveals and slow, deliberate camera moves.",
              },
              {
                icon: Clock,
                title: "Quick Turnarounds",
                body: "Generate broadcast-quality tours in minutes, not days. Perfect for hot markets where speed matters and every listing counts.",
              },
              {
                icon: TrendingUp,
                title: "Multi-Unit Complexes",
                body: "Create consistent, professional tours across dozens of units. Standardize your marketing and close faster with visual confidence.",
              },
            ].map((c, i) => (
              <div
                key={c.title}
                className="reveal-on-scroll glass-panel soft-card-hover rounded-2xl p-7"
                style={{ transitionDelay: `${i * 150}ms` }}
              >
                <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent">
                  <c.icon className="h-5 w-5 text-primary" strokeWidth={1.6} />
                </span>
                <h3 className="font-display text-lg text-foreground">
                  {c.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {c.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Testimonials ===== */}
      <section className="relative py-24">
        <div className="container">
          <div className="reveal-on-scroll mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl text-foreground sm:text-4xl">
              Trusted by real estate pros
            </h2>
          </div>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {[
              {
                quote:
                  "We went from 3 days to 3 hours per listing. Our showings are up 40% since we started using EstateTour AI.",
                author: "Sarah Chen",
                role: "Real Estate Agent, San Francisco",
              },
              {
                quote:
                  "The quality is indistinguishable from a professional videographer. At a fraction of the cost and zero scheduling headaches.",
                author: "Marcus Rodriguez",
                role: "Luxury Property Manager, Miami",
              },
              {
                quote:
                  "Our buyers love the immersive experience. We've noticed longer engagement times and more qualified leads from listings with EstateTour videos.",
                author: "Jennifer Park",
                role: "Brokerage Director, Seattle",
              },
            ].map((t, i) => (
              <div
                key={t.author}
                className="reveal-on-scroll glass-panel soft-card-hover rounded-2xl p-7"
                style={{ transitionDelay: `${i * 150}ms` }}
              >
                <div className="mb-4 flex gap-0.5">
                  {[...Array(5)].map((_, j) => (
                    <Star
                      key={j}
                      className="h-4 w-4 fill-primary text-primary"
                    />
                  ))}
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground italic">
                  "{t.quote}"
                </p>
                <div className="mt-5 border-t border-border/50 pt-4">
                  <p className="font-medium text-sm text-foreground">
                    {t.author}
                  </p>
                  <p className="text-xs text-muted-foreground">{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== CTA Banner ===== */}
      <section className="relative py-24">
        <div className="container">
          <div className="reveal-on-scroll relative overflow-hidden rounded-[2.25rem] bg-zinc-950 px-6 py-14 text-center text-white shadow-[0_35px_100px_-45px_rgba(24,24,27,.8)] sm:px-12 sm:py-20">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(255,255,255,.14),transparent_32%),radial-gradient(circle_at_85%_90%,rgba(161,161,170,.18),transparent_34%)]" />
            <div className="relative mx-auto max-w-2xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-medium text-white/70">
                <Sparkles className="h-3.5 w-3.5" /> Your next listing can
                launch today
              </span>
              <h2 className="mt-5 font-display text-3xl text-white sm:text-5xl">
                Make every listing feel like a premiere.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-white/55 sm:text-base">
                Turn six photos into a polished, social-ready property
                story—with no crew, editing timeline, or watermark.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Button
                  size="lg"
                  onClick={scrollToTool}
                  className="btn-springy rounded-full bg-white px-8 py-6 text-base text-zinc-950 hover:bg-zinc-200"
                >
                  Create your first tour <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="btn-springy rounded-full border-white/15 bg-white/10 px-8 py-6 text-white hover:bg-white/15 hover:text-white"
                  onClick={() => scrollToSection("pricing")}
                >
                  Compare plans
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== Footer ===== */}
      <footer className="mt-8 border-t border-border/70 py-10">
        <div className="container flex flex-col items-center justify-between gap-4 sm:flex-row">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clapperboard className="h-4 w-4 text-primary" /> EstateTour AI ·
            Cinematic property tours
          </span>
          <nav className="flex flex-wrap gap-6 text-sm text-muted-foreground">
            <button
              onClick={scrollToTool}
              className="transition-colors hover:text-primary"
            >
              Create a tour
            </button>
            <button
              onClick={() =>
                isAuthenticated ? navigate("/dashboard") : navigate("/login")
              }
              className="transition-colors hover:text-primary"
            >
              {isAuthenticated ? "Dashboard" : "Sign in"}
            </button>
            <button
              onClick={() => scrollToSection("pricing")}
              className="transition-colors hover:text-primary"
            >
              Pricing
            </button>
            <button
              onClick={() => scrollToSection("how-it-works")}
              className="transition-colors hover:text-primary"
            >
              How it works
            </button>
          </nav>
        </div>
      </footer>
    </div>
  );
}
