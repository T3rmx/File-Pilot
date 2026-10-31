import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { api, refreshSession, setAccessToken, setupStatus } from "./api";
import type { TokenResponse, User } from "./api";

interface AuthValue {
  status: "loading" | "ready";
  configured: boolean;
  user: User | null;
  login: (username: string, password: string) => Promise<void>;
  setup: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  resetLocal: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [configured, setConfigured] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const [sessionOk, isConfigured] = await Promise.all([
        refreshSession(),
        setupStatus().catch(() => true),
      ]);
      if (cancelled) return;

      let nextUser: User | null = null;
      if (sessionOk) {
        try {
          nextUser = await api.get<User>("/api/auth/me");
        } catch {
          nextUser = null;
        }
      }
      if (cancelled) return;
      setConfigured(isConfigured);
      setUser(nextUser);
      setStatus("ready");
    };

    void bootstrap();

    const onUnauthorized = () => {
      setAccessToken(null);
      setUser(null);
    };
    window.addEventListener("fp:unauthorized", onUnauthorized);
    return () => {
      cancelled = true;
      window.removeEventListener("fp:unauthorized", onUnauthorized);
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const data = await api.post<TokenResponse>("/api/auth/login", { username, password });
    setAccessToken(data.access_token);
    setUser(data.user);
    setConfigured(true);
  }, []);

  const setup = useCallback(async (username: string, password: string) => {
    const data = await api.post<TokenResponse>("/api/setup/", { username, password });
    setAccessToken(data.access_token);
    setUser(data.user);
    setConfigured(true);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } catch {
      /* the local session is cleared regardless */
    }
    setAccessToken(null);
    setUser(null);
  }, []);

  const resetLocal = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setConfigured(false);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ status, configured, user, login, setup, logout, resetLocal }),
    [status, configured, user, login, setup, logout, resetLocal],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
