import { MAX_IMAGE_BYTES, MAX_IMAGE_SIZE_MB } from "@shared/plans";

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_IMAGE_DIMENSION = 3072;
const JPEG_QUALITIES = [0.94, 0.9, 0.86, 0.82];

export interface PreparedImage {
  dataUrl: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  optimized: boolean;
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The image could not be read"));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("The selected image is invalid or corrupted"));
    };
    image.src = objectUrl;
  });
}

function canvasToJpeg(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob =>
        blob
          ? resolve(blob)
          : reject(new Error("The image could not be optimized")),
      "image/jpeg",
      quality
    );
  });
}

/**
 * Prepare a browser image for the base64 tRPC upload path.
 *
 * Files within the server's 10 MiB limit are returned byte-for-byte unchanged.
 * Larger images are resized/re-encoded only as much as needed to fit, using
 * high-quality smoothing and JPEG quality before reducing dimensions further.
 */
export async function prepareImageForUpload(
  file: File
): Promise<PreparedImage> {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Use a JPG, PNG, or WebP image");
  }
  if (file.size === 0) {
    throw new Error("The selected image is empty");
  }

  // Decode every file once, even when its bytes can be preserved unchanged,
  // so corrupt/spoofed files fail before reaching storage.
  const image = await loadImage(file);

  if (file.size <= MAX_IMAGE_BYTES) {
    return {
      dataUrl: await readBlobAsDataUrl(file),
      mimeType: file.type as PreparedImage["mimeType"],
      optimized: false,
    };
  }

  const initialScale = Math.min(
    1,
    MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight)
  );
  let width = Math.max(1, Math.round(image.naturalWidth * initialScale));
  let height = Math.max(1, Math.round(image.naturalHeight * initialScale));

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot optimize large images");

  // A few dimension passes handle unusually noisy photos while preserving the
  // largest possible reference image for the video model.
  for (let dimensionPass = 0; dimensionPass < 5; dimensionPass++) {
    canvas.width = width;
    canvas.height = height;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, width, height);

    for (const quality of JPEG_QUALITIES) {
      const blob = await canvasToJpeg(canvas, quality);
      if (blob.size <= MAX_IMAGE_BYTES) {
        return {
          dataUrl: await readBlobAsDataUrl(blob),
          mimeType: "image/jpeg",
          optimized: true,
        };
      }
    }

    width = Math.max(1, Math.round(width * 0.82));
    height = Math.max(1, Math.round(height * 0.82));
  }

  throw new Error(
    `Image is too large. Please use a photo under ${MAX_IMAGE_SIZE_MB} MB`
  );
}

export function dataUrlToBase64(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) throw new Error("Invalid image data");
  const base64 = dataUrl.slice(commaIndex + 1);
  if (!base64) throw new Error("The selected image is empty");
  return base64;
}
