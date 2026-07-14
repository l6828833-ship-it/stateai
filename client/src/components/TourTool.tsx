import { useCallback, useRef, useState } from "react";
import { ASPECT_RATIOS, MAX_IMAGES } from "@shared/plans";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Brain,
  Camera,
  Check,
  Clapperboard,
  Film,
  GripVertical,
  ImagePlus,
  Loader2,
  Monitor,
  RectangleHorizontal,
  Smartphone,
  Square,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface ToolImage {
  /** Stable identity: server id (number) or client cid (string) */
  id: string | number;
  previewUrl: string;
  fileName: string;
  roomTag?: string | null;
  uploading?: boolean;
}

export interface ToolSettings {
  aspectRatio: string;
}

interface TourToolProps {
  images: ToolImage[];
  settings: ToolSettings;
  onFilesAdded: (files: File[]) => void;
  onReorder: (orderedIds: Array<string | number>) => void;
  onDelete: (id: string | number) => void;
  onSettingsChange: (patch: Partial<ToolSettings>) => void;
  onGenerate: () => void;
  generateLabel?: string;
  generating?: boolean;
  disabled?: boolean;
}

/** Each aspect ratio gets an icon + plain-language purpose so users know what it's for. */
const ASPECT_META: Record<
  string,
  { icon: typeof Monitor; name: string; hint: string }
> = {
  "16:9": { icon: Monitor, name: "Widescreen", hint: "YouTube, websites & landscape" },
  "9:16": { icon: Smartphone, name: "Vertical", hint: "Reels, TikTok & Stories" },
  "1:1": { icon: Square, name: "Square", hint: "Instagram feed posts" },
  "4:3": { icon: RectangleHorizontal, name: "Classic", hint: "Standard photo frame" },
  "21:9": { icon: Film, name: "Cinematic", hint: "Ultra-wide film look" },
};

export default function TourTool({
  images,
  settings,
  onFilesAdded,
  onReorder,
  onDelete,
  onSettingsChange,
  onGenerate,
  generateLabel = "Generate Tour Video",
  generating = false,
  disabled = false,
}: TourToolProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [justDropped, setJustDropped] = useState(false);
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  const acceptFiles = useCallback(
    (fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter((f) =>
        ["image/jpeg", "image/png", "image/webp"].includes(f.type),
      );
      if (files.length === 0) {
        toast.error("Please upload JPG, PNG, or WebP photos");
        return;
      }
      const room = MAX_IMAGES - images.length;
      if (room <= 0) {
        toast.error(`Maximum ${MAX_IMAGES} photos per tour`);
        return;
      }
      if (files.length > room) {
        toast.warning(`Only ${room} more photo${room === 1 ? "" : "s"} can be added`);
      }
      onFilesAdded(files.slice(0, room));
      setJustDropped(true);
      setTimeout(() => setJustDropped(false), 1400);
    },
    [images.length, onFilesAdded],
  );

  // --- Thumbnail drag-to-reorder ---
  const handleThumbDragStart = (index: number) => {
    dragIndexRef.current = index;
    setDraggingIndex(index);
  };
  const handleThumbDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndexRef.current === null || dragIndexRef.current === index) return;
    setDragOverIndex(index);
  };
  const handleThumbDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    setDragOverIndex(null);
    setDraggingIndex(null);
    if (from === null || from === index) return;
    const ids = images.map((i) => i.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(index, 0, moved);
    onReorder(ids);
  };
  const handleThumbDragEnd = () => {
    dragIndexRef.current = null;
    setDragOverIndex(null);
    setDraggingIndex(null);
  };

  const moveImage = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= images.length) return;
    const ids = images.map((i) => i.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    onReorder(ids);
  };

  return (
    <div className="space-y-6">
      {/* Upload zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload property photos"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          acceptFiles(e.dataTransfer.files);
        }}
        className={cn(
          "relative rounded-2xl border-2 border-dashed p-8 sm:p-10 text-center transition-all duration-300 cursor-pointer select-none",
          dragOver
            ? "border-primary bg-accent/60 scale-[1.01]"
            : justDropped
              ? "border-primary bg-accent/40"
              : "border-ring/60 bg-card/60 animate-border-breathe hover:bg-accent/30",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) acceptFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="flex flex-col items-center gap-3">
          {justDropped ? (
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground animate-fade-up">
              <Check className="h-6 w-6" />
            </span>
          ) : (
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-primary">
              <ImagePlus className="h-6 w-6" />
            </span>
          )}
          <div>
            <p className="font-medium text-foreground">
              {justDropped ? "Photos added" : "Drop your property photos here"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              or click to browse — JPG, PNG, WebP · up to {MAX_IMAGES} photos
            </p>
          </div>
        </div>
      </div>

      {/* Photo sequence timeline */}
      {images.length > 0 && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
              <Camera className="h-4 w-4 text-primary" />
              Play order — the video follows this exact sequence
            </h3>
            <span className="text-xs text-muted-foreground">
              {images.length}/{MAX_IMAGES} photos
            </span>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Image 1 plays first, then Image 2, and so on — e.g. put the exterior first, then the
            living room, kitchen, and more. Drag or use ← → to arrange.
          </p>
          <div className="flex gap-3 overflow-x-auto pb-3 pt-1" role="list" aria-label="Photo order">
            {images.map((img, index) => (
              <div
                key={img.id}
                role="listitem"
                draggable={!img.uploading}
                onDragStart={() => handleThumbDragStart(index)}
                onDragOver={(e) => handleThumbDragOver(e, index)}
                onDrop={(e) => handleThumbDrop(e, index)}
                onDragEnd={handleThumbDragEnd}
                className={cn(
                  "group relative w-32 shrink-0 rounded-xl transition-all duration-300",
                  draggingIndex === index && "opacity-60 scale-95",
                  dragOverIndex === index && "translate-x-1 pink-glow",
                )}
                style={{ transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" }}
              >
                <div className="relative overflow-hidden rounded-xl border border-border bg-card soft-card-hover">
                  <img
                    src={img.previewUrl}
                    alt={img.fileName}
                    className="h-24 w-full object-cover"
                    draggable={false}
                  />
                  {img.uploading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                  )}
                  {/* Sequence badge */}
                  <span className="absolute left-1.5 top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground shadow-sm">
                    {index + 1}
                  </span>
                  {/* Controls */}
                  <div className="absolute right-1 top-1 flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      aria-label="Remove photo"
                      onClick={() => onDelete(img.id)}
                      className="rounded-full bg-background/85 p-1 text-destructive shadow-sm hover:bg-background"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="absolute bottom-1 right-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <GripVertical className="h-4 w-4 text-white drop-shadow" />
                  </div>
                </div>
                {/* Image label + move buttons */}
                <div className="mt-1.5 flex items-center justify-between gap-1">
                  <span
                    className="truncate rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-accent-foreground"
                    title={img.roomTag || img.fileName}
                  >
                    Image {index + 1}
                  </span>
                  <span className="flex gap-0.5">
                    <button
                      type="button"
                      aria-label="Move earlier"
                      onClick={() => moveImage(index, -1)}
                      disabled={index === 0}
                      className="rounded px-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      aria-label="Move later"
                      onClick={() => moveImage(index, 1)}
                      disabled={index === images.length - 1}
                      className="rounded px-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      →
                    </button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Aspect ratio — the only choice; each option is labeled with its purpose */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          Aspect ratio <span className="font-normal text-muted-foreground">— where you'll share it</span>
        </label>
        <Select
          value={settings.aspectRatio}
          onValueChange={(v) => onSettingsChange({ aspectRatio: v })}
        >
          <SelectTrigger className="rounded-xl bg-card/70">
            {(() => {
              const meta = ASPECT_META[settings.aspectRatio] ?? ASPECT_META["16:9"];
              const Icon = meta.icon;
              return (
                <span className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-primary" />
                  <span className="font-medium">{settings.aspectRatio}</span>
                  <span className="text-xs text-muted-foreground">· {meta.name}</span>
                </span>
              );
            })()}
          </SelectTrigger>
          <SelectContent>
            {ASPECT_RATIOS.map((a) => {
              const meta = ASPECT_META[a];
              const Icon = meta?.icon ?? Monitor;
              return (
                <SelectItem key={a} value={a}>
                  <Icon className="h-4 w-4 text-primary" />
                  <span className="font-medium">{a}</span>
                  <span className="text-xs text-muted-foreground">
                    · {meta?.name} — {meta?.hint}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      {/* AI direction note */}
      <div className="flex items-start gap-2.5 rounded-xl border border-primary/15 bg-accent/40 px-4 py-3 text-xs text-muted-foreground">
        <Brain className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>
          Just set the order and aspect ratio — our AI does the rest. It studies each photo, picks
          the best cinematic style and camera move for every shot (aerial reveals for exteriors,
          smooth glides inside rooms), and chooses the perfect length automatically (up to 15s).
          Every tour renders in crisp 1080p with your original photos kept pixel-perfect — no
          cropping, no quality loss.
        </p>
      </div>

      {/* Generate CTA */}
      <Button
        size="lg"
        onClick={onGenerate}
        disabled={disabled || generating || images.length === 0 || images.some((i) => i.uploading)}
        className="btn-springy w-full rounded-full py-6 text-base font-medium animate-glow-pulse"
      >
        {generating ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Preparing your tour...
          </>
        ) : (
          <>
            <Clapperboard className="mr-2 h-5 w-5" /> {generateLabel}
          </>
        )}
      </Button>
      {images.length === 0 && (
        <p className="-mt-3 text-center text-xs text-muted-foreground">
          Add at least one photo to generate your tour
        </p>
      )}
    </div>
  );
}
