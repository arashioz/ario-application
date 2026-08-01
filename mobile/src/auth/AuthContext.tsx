import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  clearSession,
  getStoredToken,
  getStoredUser,
  storeSession,
  wsClient,
} from '../api/ws';

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: 'admin' | 'marketer' | string;
}

interface AuthCtx {
  user: AuthUser | null;
  token: string | null;
  online: boolean;
  queueLen: number;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isAdmin: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(getStoredUser());
  const [token, setToken] = useState<string | null>(getStoredToken());
  const [online, setOnline] = useState(false);
  const [queueLen, setQueueLen] = useState(0);

  useEffect(() => {
    wsClient.onStatusChange = (o) => {
      setOnline(o);
      setQueueLen(wsClient.queueLength());
      // بعد از وصل شدن، نشست ذخیره‌شده را روی سوکت بازسازی کن
      if (o && getStoredToken()) {
        void wsClient.request('auth.me').catch(() => {
          // توکن معتبر نیست
        });
      }
    };
    wsClient.connect();
    const t = setInterval(() => setQueueLen(wsClient.queueLength()), 2000);
    return () => clearInterval(t);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await wsClient.request<{
      token: string;
      user: AuthUser;
    }>('auth.login', { username, password });
    storeSession(res.token, res.user);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await wsClient.request('auth.logout', {}, { token: token || undefined });
    } catch {
      /* ignore */
    }
    clearSession();
    setToken(null);
    setUser(null);
  }, [token]);

  const value = useMemo(
    () => ({
      user,
      token,
      online,
      queueLen,
      login,
      logout,
      isAdmin: user?.role === 'admin',
    }),
    [user, token, online, queueLen, login, logout]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}
