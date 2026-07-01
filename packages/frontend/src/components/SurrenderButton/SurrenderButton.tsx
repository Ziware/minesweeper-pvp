import React, { useCallback, useEffect, useRef, useState } from 'react';
import styles from './SurrenderButton.module.css';

interface SurrenderButtonProps {
  onSurrender: () => void;
  /** Timeout in ms before the confirm state resets back to idle. Default: 3000 */
  confirmTimeoutMs?: number;
}

type SurrenderState = 'idle' | 'pending';

/**
 * Two-step surrender button:
 *   1st click  → enters "pending" state (shows countdown + confirm button)
 *   2nd click  → calls onSurrender()
 *   After confirmTimeoutMs with no 2nd click → reverts to idle
 */
export function SurrenderButton({ onSurrender, confirmTimeoutMs = 3000 }: SurrenderButtonProps) {
  const [state, setState] = useState<SurrenderState>('idle');
  const [msLeft, setMsLeft] = useState(0);
  const resetTimerRef = useRef<number | null>(null);
  const tickTimerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  const clearTimers = useCallback(() => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    if (tickTimerRef.current !== null) {
      window.clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    setState('idle');
    setMsLeft(0);
  }, [clearTimers]);

  const startPending = useCallback(() => {
    clearTimers();
    startTimeRef.current = Date.now();
    setMsLeft(confirmTimeoutMs);
    setState('pending');

    resetTimerRef.current = window.setTimeout(() => {
      reset();
    }, confirmTimeoutMs);

    tickTimerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const remaining = Math.max(0, confirmTimeoutMs - elapsed);
      setMsLeft(remaining);
    }, 100);
  }, [confirmTimeoutMs, clearTimers, reset]);

  // Cleanup on unmount
  useEffect(() => () => clearTimers(), [clearTimers]);

  const handleClick = () => {
    if (state === 'idle') {
      startPending();
    } else {
      reset();
      onSurrender();
    }
  };

  const secondsLeft = Math.ceil(msLeft / 1000);

  return (
    <button
      type="button"
      className={`${styles.surrenderBtn} ${state === 'pending' ? styles.pending : ''}`}
      onClick={handleClick}
      title={state === 'idle' ? 'Сдаться (потребуется подтверждение)' : 'Нажмите ещё раз для подтверждения'}
    >
      {state === 'idle' ? (
        <>🏳️ Сдаться</>
      ) : (
        <>⚠️ Подтвердить? ({secondsLeft}с)</>
      )}
    </button>
  );
}
