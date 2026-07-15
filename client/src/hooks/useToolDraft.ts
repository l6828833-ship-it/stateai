import { ASPECT_RATIOS } from "@shared/plans";
import { useCallback, useEffect, useState } from "react";

/**
 * Guest draft state. Small settings live in localStorage; image data URLs live
 * in IndexedDB so high-quality photos do not exceed localStorage's tiny quota.
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
  aspectRatio: string;
  /** Set when the user clicked Generate while logged out. */
  pendingGenerate: boolean;
}

const STORAGE_KEY = "estatetour_draft_v1";
const DRAFT_DB_NAME = "estatetour_drafts";
const DRAFT_DB_VERSION = 1;
const DRAFT_STORE = "images";
const DRAFT_IMAGES_KEY = "active";

export const EMPTY_DRAFT: ToolDraft = {
  images: [],
  aspectRatio: "16:9",
  pendingGenerate: false,
};

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Browser image storage is unavailable"));
      return;
    }
    const request = indexedDB.open(DRAFT_DB_NAME, DRAFT_DB_VERSION);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open image storage"));
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DRAFT_STORE)) {
        request.result.createObjectStore(DRAFT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function loadDraftImages(): Promise<DraftImage[]> {
  const db = await openDraftDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DRAFT_STORE, "readonly");
    const request = transaction.objectStore(DRAFT_STORE).get(DRAFT_IMAGES_KEY);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not read saved photos"));
    request.onsuccess = () =>
      resolve((request.result as DraftImage[] | undefined) ?? []);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Could not read saved photos"));
    };
  });
}

async function saveDraftImages(images: DraftImage[]): Promise<void> {
  const db = await openDraftDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DRAFT_STORE, "readwrite");
    transaction.objectStore(DRAFT_STORE).put(images, DRAFT_IMAGES_KEY);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(
        transaction.error ?? new Error("Could not save photos in this browser")
      );
    };
  });
}

async function clearDraftImages(): Promise<void> {
  const db = await openDraftDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DRAFT_STORE, "readwrite");
    transaction.objectStore(DRAFT_STORE).delete(DRAFT_IMAGES_KEY);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Could not clear saved photos"));
    };
  });
}

/** Synchronous metadata/legacy loader used for the initial render. */
export function loadDraft(): ToolDraft {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_DRAFT };
    const parsed = JSON.parse(raw) as Partial<ToolDraft>;
    const aspectRatio = ASPECT_RATIOS.some(
      (supported) => supported === parsed.aspectRatio,
    )
      ? parsed.aspectRatio!
      : EMPTY_DRAFT.aspectRatio;
    return {
      ...EMPTY_DRAFT,
      ...parsed,
      aspectRatio,
      images: parsed.images ?? [],
    };
  } catch {
    return { ...EMPTY_DRAFT };
  }
}

/** Load metadata plus high-quality image payloads from IndexedDB. */
export async function loadDraftWithImages(): Promise<ToolDraft> {
  const metadata = loadDraft();
  // Migrate drafts written by the previous localStorage-only implementation.
  // If migration storage is unavailable, the legacy payload remains complete.
  if (metadata.images.length > 0) {
    try {
      await saveDraftImages(metadata.images);
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...metadata, images: [] })
      );
    } catch {
      // Keep the complete legacy draft in localStorage for a future retry.
    }
    return metadata;
  }

  // Never turn an IndexedDB failure into an apparently valid image-less draft.
  // Callers must preserve storage and surface/retry the error.
  return { ...metadata, images: await loadDraftImages() };
}

export async function saveDraft(draft: ToolDraft): Promise<void> {
  await saveDraftImages(draft.images);
  // Keep only lightweight settings in localStorage; base64 photos belong in IDB.
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...draft, images: [] }));
}

export async function clearDraft(): Promise<void> {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } finally {
    try {
      await clearDraftImages();
    } catch {
      // Clearing metadata is sufficient to prevent an automatic restore. Any
      // orphaned IndexedDB payload will be overwritten by the next draft.
    }
  }
}

export function useToolDraft() {
  const [draft, setDraft] = useState<ToolDraft>(() =>
    typeof window === "undefined" ? { ...EMPTY_DRAFT } : loadDraft()
  );
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    void loadDraftWithImages()
      .then(loaded => {
        if (!active) return;
        // Merge any photos selected while IndexedDB was loading with previously
        // saved ones. Stable client IDs prevent duplicates and preserve order.
        setDraft(current => {
          const mergedImages = [...loaded.images];
          const loadedIds = new Set(loaded.images.map(image => image.cid));
          for (const image of current.images) {
            if (!loadedIds.has(image.cid)) mergedImages.push(image);
          }
          return { ...loaded, ...current, images: mergedImages };
        });
        setHydrated(true);
      })
      .catch(error => {
        console.warn("[Draft] Could not restore saved guest photos:", error);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void saveDraft(draft).catch(error => {
      console.warn("[Draft] Could not persist guest photos:", error);
    });
  }, [draft, hydrated]);

  const update = useCallback((patch: Partial<ToolDraft>) => {
    setDraft(current => ({ ...current, ...patch }));
  }, []);

  return { draft, update, setDraft };
}
