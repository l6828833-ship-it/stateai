import { COOKIE_NAME } from "@shared/const";

function getBearerFallback(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem("manus-cookie");
    if (!raw) return null;
    const prefix = `${COOKIE_NAME}=`;
    const pair = raw.split(";").find(value => value.trim().startsWith(prefix));
    return pair?.trim().slice(prefix.length) || null;
  } catch {
    return null;
  }
}

/** Authenticated same-origin fetch for REST endpoints outside tRPC. */
export function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
) {
  const headers = new Headers(init.headers);
  const token = getBearerFallback();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  // Required by sensitive billing mutations. Cross-site HTML forms cannot set
  // this header, and cross-origin fetches cannot pass the browser preflight.
  headers.set("X-EstateTour-Request", "billing");
  return globalThis.fetch(input, {
    ...init,
    headers,
    credentials: "include",
  });
}
