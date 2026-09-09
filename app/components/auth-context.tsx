"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { onSessionExpired } from "@/app/lib/api-client";

interface AuthContextValue {
  user: string | null;
  authenticated: boolean;
  loading: boolean;
  logout: () => void;
  logoutError: string | null;
  sessionError: string | null;
  reloadSession: () => void;
}

interface SessionResponse {
  username?: string;
  authenticated?: boolean;
  expiresAt?: number;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Cookies are shared across tabs. Hold the lock until response headers/body settle
// so a delayed renewal cannot restore the cookie after another tab signs out.
async function withSessionCookieLock<T>(action: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return navigator.locks
    ? await navigator.locks.request("proxmox-session-cookie", { signal }, action)
    : action();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const expiresAt = useRef<number>(0);
  const logoutPending = useRef(false);
  const sessionRequest = useRef<AbortController | null>(null);
  const renewalRequest = useRef<{ controller: AbortController; promise: Promise<void> } | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionVersion, setSessionVersion] = useState(0);
  const reloadSession = useCallback(() => { setLoading(true); setSessionVersion(value => value + 1); }, []);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();
    sessionRequest.current = controller;

    const loadSession = async () => {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store", signal: controller.signal });
        if (!response.ok && response.status !== 401) throw new Error("Session service is unavailable");
        const data = (await response.json()) as SessionResponse;

        if (!mounted || controller.signal.aborted || logoutPending.current) {
          return;
        }

        setSessionError(null);
        if (response.ok && data.authenticated && data.username) {
          expiresAt.current = data.expiresAt || 0;
          setUser(data.username);
          setAuthenticated(true);
        } else {
          setUser(null);
          setAuthenticated(false);
          if (window.location.pathname !== "/login") router.replace("/login?expired=1");
        }
      } catch {
        if (!mounted || controller.signal.aborted || logoutPending.current) {
          return;
        }

        setUser(null);
        setAuthenticated(false);
        setSessionError("Unable to verify the session. Check the connection to Proxmox and try again.");
      } finally {
        if (sessionRequest.current === controller) sessionRequest.current = null;
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadSession();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [router, sessionVersion]);

  const logout = useCallback(() => {
    if (logoutPending.current) return;
    logoutPending.current = true;
    sessionRequest.current?.abort();
    const activeRenewal = renewalRequest.current;
    activeRenewal?.controller.abort();
    void (async () => {
      setLogoutError(null);
      try {
        // Wait for abort to settle before sending the final cookie-clearing response.
        await activeRenewal?.promise;
        const signal = AbortSignal.timeout(45000);
        const response = await withSessionCookieLock(
          () => fetch("/api/auth/logout", { method: "POST", signal }), signal,
        );
        if (!response.ok) throw new Error("Sign out failed. Please try again.");
        setUser(null);
        setAuthenticated(false);
        router.push("/login");
        router.refresh();
      } catch {
        logoutPending.current = false;
        setLogoutError("Unable to sign out. Your session is still active. Check the connection and try again.");
      }
    })();
  }, [router]);

  useEffect(() => {
    return onSessionExpired(() => {
      logoutPending.current = true;
      sessionRequest.current?.abort();
      renewalRequest.current?.controller.abort();
      setUser(null);
      setAuthenticated(false);
      router.push("/login?expired=1");
      router.refresh();
    });
  }, [router]);

  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    let lastRenewed = Date.now();
    const renew = () => {
      if (cancelled || logoutPending.current || renewalRequest.current || document.visibilityState === "hidden" || (Date.now() - lastRenewed < 30 * 60 * 1000 && (!expiresAt.current || expiresAt.current - Date.now() > 30 * 60 * 1000))) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]);
      const request = { controller, promise: Promise.resolve() };
      renewalRequest.current = request;
      request.promise = (async () => {
        try {
          await withSessionCookieLock(async () => {
            if (cancelled || logoutPending.current || signal.aborted) return;
            const response = await fetch("/api/auth/session", { method: "POST", cache: "no-store", signal });
            if (cancelled || logoutPending.current || signal.aborted) return;
            if (response.ok) {
              const data = await response.json() as SessionResponse;
              if (cancelled || logoutPending.current || signal.aborted) return;
              lastRenewed = Date.now(); expiresAt.current = data.expiresAt || 0;
            }
            else if (response.status === 401) {
              setUser(null); setAuthenticated(false);
              router.push("/login?expired=1");
            }
          }, signal);
        } catch { /* Keep the current session during temporary network outages. */ }
        finally { if (renewalRequest.current === request) renewalRequest.current = null; }
      })();
    };
    void renew();
    const timer = setInterval(() => void renew(), 60000);
    const focus = () => void renew();
    window.addEventListener("focus", focus);
    return () => { cancelled = true; renewalRequest.current?.controller.abort(); clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [authenticated, router]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    authenticated,
    loading,
    logout,
    logoutError,
    sessionError,
    reloadSession,
  }), [authenticated, loading, logout, logoutError, sessionError, reloadSession, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
