import { useState, useEffect, useCallback } from 'react';

const API_BASE = '/api';
const TOKEN_KEY = 'auth_token';

export interface UserProfile {
  avatarUrl:   string | null;
  rating:      number;
  gamesPlayed: number;
  wins:        number;
}

export interface AuthUser {
  id:            string;
  login:         string;
  email:         string;
  createdAt:     string;
  emailVerified: boolean;
  verifiedAt:    string | null;
  profile:       UserProfile | null;
}

export interface AuthState {
  user:      AuthUser | null;
  isGuest:   boolean;
  isLoading: boolean;
  token:     string | null;
}

export interface AuthApi extends AuthState {
  /** Step 1 of registration: creates user, sends verification email. */
  register:    (email: string, login: string, password: string) => Promise<void>;
  /** Step 2: submit code received by email → returns JWT. */
  verifyEmail: (email: string, code: string) => Promise<void>;
  /** Login with email or login + password. */
  login:       (emailOrLogin: string, password: string) => Promise<void>;
  logout:      () => void;
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiPost<T>(path: string, body: unknown, token?: string | null): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'UNKNOWN', data.message ?? 'Ошибка сервера');
  return data as T;
}

async function apiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'UNKNOWN', data.message ?? 'Ошибка сервера');
  return data as T;
}

export class ApiError extends Error {
  constructor(
    public status:  number,
    public code:    string,
    public message: string,
  ) {
    super(message);
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth(): AuthApi {
  const [state, setState] = useState<AuthState>({
    user:      null,
    isGuest:   true,
    isLoading: true,
    token:     null,
  });

  // On mount: check existing token
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setState({ user: null, isGuest: true, isLoading: false, token: null });
      return;
    }
    apiGet<{ user: AuthUser }>('/users/me', token)
      .then(({ user }) => {
        setState({ user, isGuest: false, isLoading: false, token });
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setState({ user: null, isGuest: true, isLoading: false, token: null });
      });
  }, []);

  const setAuthed = useCallback((token: string, user: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, token);
    setState({ user, isGuest: false, isLoading: false, token });
  }, []);

  const register = useCallback(async (email: string, login: string, password: string) => {
    await apiPost('/auth/register', { email, login, password, passwordConfirm: password });
    // No token yet — user must verify email next
  }, []);

  const verifyEmail = useCallback(async (email: string, code: string) => {
    const data = await apiPost<{ token: string; user: AuthUser }>('/auth/verify-email', { email, code });
    setAuthed(data.token, data.user);
  }, [setAuthed]);

  const login = useCallback(async (emailOrLogin: string, password: string) => {
    const data = await apiPost<{ token: string; user: AuthUser }>('/auth/login', { emailOrLogin, password });
    setAuthed(data.token, data.user);
  }, [setAuthed]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setState({ user: null, isGuest: true, isLoading: false, token: null });
  }, []);

  return { ...state, register, verifyEmail, login, logout };
}
