// Supabase Storage helpers (server-side only).
// Uploads use the private Storage REST API with the service-role key.
// Browser-facing URLs remain /manus-storage/{key} for compatibility and are
// resolved to short-lived Supabase signed URLs by storageProxy.ts.

import { ENV } from "./_core/env";

const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 60;

function getSupabaseStorageConfig() {
  const configuredUrl = ENV.supabaseUrl.trim();
  const serviceRoleKey = ENV.supabaseServiceRoleKey.trim();
  const bucket = ENV.supabaseStorageBucket.trim();

  if (!configuredUrl || !serviceRoleKey) {
    throw new Error(
      "Supabase Storage config missing: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
    );
  }
  if (!bucket) {
    throw new Error(
      "Supabase Storage config missing: set SUPABASE_STORAGE_BUCKET"
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(configuredUrl);
  } catch {
    throw new Error(
      "SUPABASE_URL must be a valid URL such as https://your-project.supabase.co"
    );
  }
  const isLocal =
    parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1";
  if (parsedUrl.protocol !== "https:" && !isLocal) {
    throw new Error("SUPABASE_URL must use HTTPS");
  }

  return { supabaseUrl: parsedUrl.origin, serviceRoleKey, bucket };
}

function normalizeKey(relKey: string): string {
  const key = relKey.replace(/^\/+/, "");
  if (
    !key ||
    key
      .split("/")
      .some(segment => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("Invalid storage key");
  }
  return key;
}

function encodePath(value: string): string {
  return value
    .split("/")
    .map(segment => encodeURIComponent(segment))
    .join("/");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

function storageHeaders(serviceRoleKey: string): Record<string, string> {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  };
}

async function readSupabaseError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  if (!body) return response.statusText;
  try {
    const parsed = JSON.parse(body) as { message?: string; error?: string };
    return parsed.message || parsed.error || body;
  } catch {
    return body;
  }
}

function storageError(
  operation: string,
  status: number,
  detail: string,
  bucket: string
): Error {
  console.error(
    `[SupabaseStorage] ${operation} failed (${status}) in bucket "${bucket}": ${detail}`
  );
  if (/bucket.*not found|not found.*bucket/i.test(detail)) {
    return new Error(
      "Storage is not configured correctly. Create the configured private bucket or update SUPABASE_STORAGE_BUCKET"
    );
  }
  if (status === 401 || status === 403) {
    return new Error(
      "Storage authentication failed. Check the server-only Supabase Storage configuration"
    );
  }
  return new Error(`Storage ${operation} failed. Please try again`);
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const { supabaseUrl, serviceRoleKey, bucket } = getSupabaseStorageConfig();
  const key = appendHashSuffix(normalizeKey(relKey));
  const objectUrl = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodePath(key)}`;
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as BlobPart], { type: contentType });

  const response = await fetch(objectUrl, {
    method: "POST",
    headers: {
      ...storageHeaders(serviceRoleKey),
      "Content-Type": contentType,
      "x-upsert": "false",
    },
    body: blob,
  });

  if (!response.ok) {
    const detail = await readSupabaseError(response);
    throw storageError("upload", response.status, detail, bucket);
  }

  return { key, url: `/manus-storage/${encodePath(key)}` };
}

export async function storageGet(
  relKey: string
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/manus-storage/${encodePath(key)}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const { supabaseUrl, serviceRoleKey, bucket } = getSupabaseStorageConfig();
  const key = normalizeKey(relKey);
  const signUrl = `${supabaseUrl}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodePath(key)}`;

  const response = await fetch(signUrl, {
    method: "POST",
    headers: {
      ...storageHeaders(serviceRoleKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: DEFAULT_SIGNED_URL_TTL_SECONDS }),
  });

  if (!response.ok) {
    const detail = await readSupabaseError(response);
    throw storageError("signed URL", response.status, detail, bucket);
  }

  const result = (await response.json()) as {
    signedURL?: string;
    signedUrl?: string;
  };
  const signedUrl = result.signedURL ?? result.signedUrl;
  if (!signedUrl)
    throw new Error("Supabase Storage returned an empty signed URL");

  if (/^https?:\/\//i.test(signedUrl)) return signedUrl;
  // Storage API commonly returns `/object/sign/...`; some deployments return
  // `/storage/v1/object/sign/...`. Normalize both forms against the project URL.
  if (signedUrl.startsWith("/storage/v1/")) return `${supabaseUrl}${signedUrl}`;
  if (signedUrl.startsWith("/object/")) {
    return `${supabaseUrl}/storage/v1${signedUrl}`;
  }
  return `${supabaseUrl}/storage/v1/${signedUrl.replace(/^\/+/, "")}`;
}
