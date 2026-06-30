import React, { useEffect, useRef } from 'react';
import styles from './SettingsMenu.module.css';
import { VOLUME_MAX, VOLUME_MIN } from '../../hooks/useSettings';

interface SettingsMenuProps {
  muted: boolean;
  volume: number;
  hideControls: boolean;
  flagClickDefuse: boolean;
  onToggleMuted: () => void;
  onVolumeChange: (value: number) => void;
  onToggleHideControls: () => void;
  onToggleFlagClickDefuse: () => void;
  /** Закрыть меню (клик вне области или Esc) */
  onClose: () => void;
}

/**
 * Выпадающее меню настроек, привязанное к кнопке «⚙️ Настройки» в шапке.
 * Закрывается по клику снаружи и по Esc.
 */
export function SettingsMenu({
  muted,
  volume,
  hideControls,
  flagClickDefuse,
  onToggleMuted,
  onVolumeChange,
  onToggleHideControls,
  onToggleFlagClickDefuse,
  onClose,
}: SettingsMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      const target = e.target as Node | null;
      if (target && rootRef.current.contains(target)) return;
      // Не закрывать, если клик пришёл по кнопке-триггеру/якорю меню —
      // иначе её onClick тут же откроет меню обратно.
      if (target instanceof Element && target.closest('[data-settings-anchor]')) {
        return;
      }
      onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const volumePercent = Math.round(volume * 100);

  return (
    <div ref={rootRef} className={styles.menu} role="menu">
      <div className={styles.title}>⚙️ Настройки</div>

      <div className={styles.row}>
        <span className={styles.label}>{muted ? '🔇 Звук' : '🔊 Звук'}</span>
        <button
          type="button"
          className={`${styles.toggle} ${muted ? styles.toggleOff : styles.toggleOn}`}
          onClick={onToggleMuted}
          aria-pressed={!muted}
        >
          <span className={styles.toggleKnob} />
        </button>
      </div>

      <div className={styles.rowColumn}>
        <div className={styles.volumeHeader}>
          <span className={styles.label}>🎚️ Громкость</span>
          <span className={styles.volumeValue}>{volumePercent}%</span>
        </div>
        <input
          type="range"
          min={VOLUME_MIN}
          max={VOLUME_MAX}
          step={0.05}
          value={volume}
          disabled={muted}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          className={styles.slider}
        />
        <div className={styles.volumeScale}>
          <span>0%</span>
          <span>100%</span>
          <span>200%</span>
        </div>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>🎮 Скрыть подсказки</span>
        <button
          type="button"
          className={`${styles.toggle} ${hideControls ? styles.toggleOn : styles.toggleOff}`}
          onClick={onToggleHideControls}
          aria-pressed={hideControls}
        >
          <span className={styles.toggleKnob} />
        </button>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>🚩 Клик по флагу = разминирование</span>
        <button
          type="button"
          className={`${styles.toggle} ${flagClickDefuse ? styles.toggleOn : styles.toggleOff}`}
          onClick={onToggleFlagClickDefuse}
          aria-pressed={flagClickDefuse}
        >
          <span className={styles.toggleKnob} />
        </button>
      </div>
    </div>
  );
}
