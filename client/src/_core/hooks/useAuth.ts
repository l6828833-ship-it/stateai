import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  // Login is started via startLogin() in the effect below, only when we actually
  // navigate — never during render. startLogin() mints a one-time nonce + writes
  // the state cookie, so calling it per render would overwrite the cookie and
  // desync it from an in-flight login's `state`.
  const { redirectOnUnauthenticated = false, redirectPath } = options ?? {};
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  // A cached unauthenticated result can remain visible while a refetch is in
  // flight. Route guards must wait for that refetch before deciding to send the
  // user back to login.
  const authQueryPending =
    meQuery.isLoading || (meQuery.isFetching && !meQuery.data);

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      // Clear the Preview auto-login token mirrored into sessionStorage, so
      // header-based sessions (Safari ITP / WebView) are logged out too. The
      // backend cookie is cleared by the logout mutation.
      try {
        sessionStorage.removeItem("manus-cookie");
      } catch {}
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils]);

  // Keep the preview runtime cache best-effort. Browser privacy settings,
  // embedded previews, or a full storage quota can make localStorage throw;
  // none of those conditions should prevent auth state from rendering.
  useEffect(() => {
    try {
      localStorage.setItem(
        "manus-runtime-user-info",
        JSON.stringify(meQuery.data)
      );
    } catch {
      // The server session remains canonical when browser storage is unavailable.
    }
  }, [meQuery.data]);

  const state = useMemo(() => {
    return {
      user: meQuery.data ?? null,
      loading: authQueryPending || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    };
  }, [
    authQueryPending,
    meQuery.data,
    meQuery.error,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (authQueryPending || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (redirectPath && window.location.pathname === redirectPath) return;

    // Navigate at this moment only. startLogin() mints the nonce + cookie itself.
    if (redirectPath) {
      window.location.href = redirectPath;
    } else {
      startLogin();
    }
  }, [
    authQueryPending,
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
