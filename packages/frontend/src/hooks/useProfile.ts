import { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE = '/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActivityDay {
  date:  string;
  count: number;
}

export interface PublicProfileStats {
  avatarUrl:         string | null;
  bio:               string | null;
  rating:            number;
  gamesPlayed:       number;
  wins:              number;
  ratedGamesPlayed:  number;
  ratedWins:         number;
  tournamentsPlayed: number;
  tournamentWins:    number;
}

export interface PublicProfile {
  id:            string;
  login:         string;
  email?:        string;          // only present when isMe
  createdAt:     string;
  emailVerified?: boolean;        // only present when isMe
  profile:       PublicProfileStats | null;
}

export interface GameParticipantRecord {
  id:       string;
  userId:   string | null;
  color:    'red' | 'blue';
  name:     string;
  isBot:    boolean;
  isWinner: boolean;
}

export interface GameRecord {
  id:           string;
  sessionId:    string;
  mode:         'pvp' | 'solo';
  isRated:      boolean;
  startedAt:    string;
  endedAt:      string;
  durationMs:   number;
  turnsPlayed:  number;
  winnerColor:  'red' | 'blue' | null;
  winReason:    string;
  participants: GameParticipantRecord[];
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? 'Ошибка сервера');
  return data as T;
}

async function apiPatch<T>(path: string, body: unknown, token: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? 'Ошибка сервера');
  return data as T;
}

async function apiUpload<T>(path: string, file: File, token: string): Promise<T> {
  const form = new FormData();
  form.append('avatar', file);
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? 'Ошибка сервера');
  return data as T;
}

async function apiDelete<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? 'Ошибка сервера');
  return data as T;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useProfile(login: string, myId?: string, token?: string | null) {
  const [profile,    setProfile]    = useState<PublicProfile | null>(null);
  const [games,      setGames]      = useState<GameRecord[]>([]);
  const [total,      setTotal]      = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page,       setPage]       = useState(1);
  const [isLoading,  setIsLoading]  = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [activity,   setActivity]   = useState<ActivityDay[]>([]);
  // Track last login fetched to avoid double-fetching on token change
  const activityFetchedRef = useRef<string | null>(null);

  const isMe = !!myId && profile?.id === myId;

  // Load profile
  useEffect(() => {
    if (!login) return;
    setIsLoading(true);
    setError(null);
    apiFetch<{ user: PublicProfile }>(`/users/${login}`, token)
      .then(({ user }) => setProfile(user))
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [login, token]);

  // Load games when profile loaded or page changes
  useEffect(() => {
    if (!login) return;
    apiFetch<{ games: GameRecord[]; total: number; totalPages: number }>(
      `/users/${login}/games?page=${page}&limit=25`,
      token,
    )
      .then(({ games, total, totalPages }) => {
        setGames(games);
        setTotal(total);
        setTotalPages(totalPages);
      })
      .catch(() => { /* silently fail for games list */ });
  }, [login, page, token]);

  // Load activity heatmap once per login
  useEffect(() => {
    if (!login || activityFetchedRef.current === login) return;
    activityFetchedRef.current = login;
    apiFetch<{ activity: ActivityDay[] }>(`/users/${login}/activity`, token)
      .then(({ activity }) => setActivity(activity))
      .catch(() => { /* silently fail */ });
  }, [login, token]);

  const updateProfile = useCallback(async (bio: string | null, avatarUrl?: string | null) => {
    if (!token) throw new Error('Требуется авторизация');
    const { profile: updated } = await apiPatch<{ profile: PublicProfileStats }>(
      '/users/me/profile',
      { bio, ...(avatarUrl !== undefined ? { avatarUrl } : {}) },
      token,
    );
    setProfile((prev) => prev ? { ...prev, profile: updated } : prev);
  }, [token]);

  const uploadAvatar = useCallback(async (file: File): Promise<string> => {
    if (!token) throw new Error('Требуется авторизация');
    const { avatarUrl } = await apiUpload<{ avatarUrl: string }>('/users/me/avatar', file, token);
    setProfile((prev) => prev ? {
      ...prev,
      profile: prev.profile ? { ...prev.profile, avatarUrl } : null,
    } : prev);
    return avatarUrl;
  }, [token]);

  const deleteAvatar = useCallback(async (): Promise<void> => {
    if (!token) throw new Error('Требуется авторизация');
    const { profile: updated } = await apiDelete<{ profile: PublicProfileStats }>('/users/me/avatar', token);
    setProfile((prev) => prev ? { ...prev, profile: updated } : prev);
  }, [token]);

  const deleteAccount = useCallback(async (): Promise<void> => {
    if (!token) throw new Error('Требуется авторизация');
    await apiDelete<{ ok: boolean }>('/users/me', token);
  }, [token]);

  const resendVerification = useCallback(async (email: string) => {
    const res = await fetch(`${API_BASE}/auth/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.message ?? 'Ошибка сервера');
    }
  }, []);

  const verifyEmailCode = useCallback(async (email: string, code: string): Promise<{ token: string }> => {
    const res = await fetch(`${API_BASE}/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? 'Ошибка сервера');
    // Mark profile as verified locally
    setProfile((prev) => prev ? { ...prev, emailVerified: true } : prev);
    return { token: data.token };
  }, []);

  return {
    profile,
    games,
    activity,
    total,
    totalPages,
    page,
    setPage,
    isLoading,
    error,
    isMe,
    updateProfile,
    uploadAvatar,
    deleteAvatar,
    deleteAccount,
    resendVerification,
    verifyEmailCode,
  };
}
