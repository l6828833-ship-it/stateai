import { useCallback, useEffect, useState } from "react";
import type { TourStyleId } from "@shared/plans";

/**
 * Guest draft state persisted in localStorage. When an unauthenticated user
 * uploads photos and configures settings on the homepage, everything is kept
 * here (images as data URLs) so it survives the sign-up redirect and is then
 * synced to the server after login.
 */

export interface DraftImage {
  /** Client-side id */
  cid: string;
  fileName: string;
  mimeType: string;
  /** data URL for preview + later upload */
  dataUrl: string;
  roomTag?: string;
}

export interface ToolDraft {
  images: DraftImage[];
  tourStyle: TourStyleId;
  creativeText: string;
  resolution: string;
  aspectRatio: string;
  clipDuration: number;
  /** Set when the user clicked Generate while logged out. */
  pendingGenerate: boolean;
}

const STORAGE_KEY = "estatetour_draft_v1";

export const EMPTY_DRAFT: ToolDraft = {
  images: [],
  tourStyle: "Walkthrough",
  creativeText: "",
  resolution: "720p",
  aspectRatio: "16:9",
  clipDuration: 5,
  pendingGenerate: false,
};

export function loadDraft(): ToolDraft {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_DRAFT };
    const parsed = JSON.parse(raw) as Partial<ToolDraft>;
    return { ...EMPTY_DRAFT, ...parsed, images: parsed.images ?? [] };
  } catch {
    return { ...EMPTY_DRAFT };
  }
}

export function saveDraft(draft: ToolDraft) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch (e) {
    // Quota exceeded with large images — drop the oldest image and retry once.
    if (draft.images.length > 0) {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...draft, images: draft.images.slice(0, Math.max(1, draft.images.length - 1)) }),
        );
      } catch {
        /* give up silently */
      }
    }
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

export function useToolDraft() {
  const [draft, setDraft] = useState<ToolDraft>(() =>
    typeof window === "undefined" ? { ...EMPTY_DRAFT } : loadDraft(),
  );

  useEffect(() => {
    saveDraft(draft);
  }, [draft]);

  const update = useCallback((patch: Partial<ToolDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
  }, []);

  return { draft, update, setDraft };
}

/** Read a File as a data URL (downscaled to keep localStorage manageable). */
export function fileToDataUrl(file: File, maxDim = 1600): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Invalid image"));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        if (scale >= 1) {
          resolve(reader.result as string);
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(reader.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
