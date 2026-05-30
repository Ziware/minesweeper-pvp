import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Пользовательские настройки клиента, сохраняемые в localStorage браузера.
 */
export interface UserSettings {
  /** Звук выключен полностью */
  muted: boolean;
  /** Громкость в диапазоне 0..2 (1.0 = 100 %, 2.0 = 200 %) */
  volume: number;
  /** Скрыть блок «Управление» в правой колонке */
  hideControls: boolean;
}

const STORAGE_KEY = 'minesweeper_settings';

const DEFAULT_SETTINGS: UserSettings = {
  muted: false,
  volume: 1,
  hideControls: false,
};

export const VOLUME_MIN = 0;
export const VOLUME_MAX = 2;

function loadSettings(): UserSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS };
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    const muted = typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULT_SETTINGS.muted;
    const rawVolume = typeof parsed.volume === 'number' && Number.isFinite(parsed.volume)
      ? parsed.volume
      : DEFAULT_SETTINGS.volume;
    const volume = Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, rawVolume));
    const hideControls = typeof parsed.hideControls === 'boolean'
      ? parsed.hideControls
      : DEFAULT_SETTINGS.hideControls;
    return { muted, volume, hideControls };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings: UserSettings) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('[settings] failed to save', e);
  }
}

export interface SettingsApi {
  settings: UserSettings;
  /** Текущее значение громкости через ref — для аудиокода без переподписки */
  volumeRef: React.MutableRefObject<number>;
  /** Аналогично для muted */
  mutedRef: React.MutableRefObject<boolean>;
  setMuted: (value: boolean) => void;
  toggleMuted: () => void;
  setVolume: (value: number) => void;
  setHideControls: (value: boolean) => void;
  toggleHideControls: () => void;
}

export function useSettings(): SettingsApi {
  const [settings, setSettings] = useState<UserSettings>(() => loadSettings());

  const volumeRef = useRef(settings.volume);
  const mutedRef = useRef(settings.muted);

  useEffect(() => {
    volumeRef.current = settings.volume;
    mutedRef.current = settings.muted;
    saveSettings(settings);
  }, [settings]);

  const setMuted = useCallback((value: boolean) => {
    setSettings((s) => ({ ...s, muted: value }));
  }, []);
  const toggleMuted = useCallback(() => {
    setSettings((s) => ({ ...s, muted: !s.muted }));
  }, []);
  const setVolume = useCallback((value: number) => {
    const clamped = Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, value));
    setSettings((s) => ({ ...s, volume: clamped }));
  }, []);
  const setHideControls = useCallback((value: boolean) => {
    setSettings((s) => ({ ...s, hideControls: value }));
  }, []);
  const toggleHideControls = useCallback(() => {
    setSettings((s) => ({ ...s, hideControls: !s.hideControls }));
  }, []);

  return {
    settings,
    volumeRef,
    mutedRef,
    setMuted,
    toggleMuted,
    setVolume,
    setHideControls,
    toggleHideControls,
  };
}
