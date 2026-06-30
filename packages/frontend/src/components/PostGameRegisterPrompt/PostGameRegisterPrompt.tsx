import React, { useState } from 'react';
import { ApiError } from '../../hooks/useAuth';
import type { AuthApi } from '../../hooks/useAuth';
import styles from './PostGameRegisterPrompt.module.css';

const API_BASE = '/api';
const TOKEN_KEY = 'auth_token';

interface Props {
  sessionId: string;
  color: 'red' | 'blue';
  auth: AuthApi;
  onDismiss: () => void;
}

type Step = 'form' | 'verify' | 'done';

export function PostGameRegisterPrompt({ sessionId, color, auth, onDismiss }: Props) {
  const [step,            setStep]            = useState<Step>('form');
  const [email,           setEmail]           = useState('');
  const [login,           setLogin]           = useState('');
  const [password,        setPassword]        = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [code,            setCode]            = useState('');
  const [error,           setError]           = useState('');
  const [loading,         setLoading]         = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== passwordConfirm) {
      setError('Пароли не совпадают');
      return;
    }
    setLoading(true);
    try {
      await auth.register(email.trim(), login.trim(), password);
      setStep('verify');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ошибка регистрации');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // This stores the JWT in localStorage and updates auth state
      await auth.verifyEmail(email.trim(), code.trim());

      // Claim the game using the freshly-stored token
      const token = localStorage.getItem(TOKEN_KEY);
      if (token && sessionId) {
        try {
          const res = await fetch(`${API_BASE}/users/me/claim-game`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ sessionId, color }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            // Non-fatal — user is registered, just the game link may have failed
            console.warn('[PostGameRegister] claim-game failed:', data);
          }
        } catch (claimErr) {
          console.warn('[PostGameRegister] claim-game network error:', claimErr);
        }
      }

      setStep('done');
    } catch (err) {
      const isCodeError = err instanceof ApiError && (err.status === 400 || err.status === 422);
      if (!isCodeError) {
        // Network/server error — registration succeeded, verification uncertain.
        // Try logging in directly with credentials.
        try {
          await auth.login(email.trim(), password);
        } catch {
          // Ignore
        }
        setStep('done');
      } else {
        setError(err instanceof ApiError ? err.message : 'Неверный код');
      }
    } finally {
      setLoading(false);
    }
  };

  if (step === 'done') {
    return (
      <div className={styles.overlay} onClick={onDismiss}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
          <button className={styles.closeBtn} onClick={onDismiss} aria-label="Закрыть">✕</button>
          <div className={styles.doneIcon}>🎉</div>
          <h2 className={styles.title}>Аккаунт создан!</h2>
          <p className={styles.desc}>
            Ваш результат сохранён. Теперь статистика и история игр будут отображаться в профиле.
          </p>
          <button className={styles.submitBtn} onClick={onDismiss}>
            Продолжить
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.overlay} onClick={onDismiss}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onDismiss} aria-label="Закрыть">✕</button>

        {step === 'form' ? (
          <>
            <h2 className={styles.title}>Сохранить результат</h2>
            <p className={styles.desc}>
              Создайте аккаунт, чтобы сохранить эту игру в своей статистике.
            </p>
            <form onSubmit={handleRegister} className={styles.form}>
              <label className={styles.label}>
                Email
                <input
                  className={styles.input}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  disabled={loading}
                  autoFocus
                />
              </label>

              <label className={styles.label}>
                Логин <span className={styles.hint}>(3–20 символов, a–z 0–9 _ -)</span>
                <input
                  className={styles.input}
                  type="text"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  autoComplete="username"
                  minLength={3}
                  maxLength={20}
                  pattern="[a-zA-Z0-9_-]+"
                  required
                  disabled={loading}
                />
              </label>

              <label className={styles.label}>
                Пароль <span className={styles.hint}>(минимум 8 символов)</span>
                <input
                  className={styles.input}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  disabled={loading}
                />
              </label>

              <label className={styles.label}>
                Пароль ещё раз
                <input
                  className={styles.input}
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  disabled={loading}
                />
              </label>

              {error && <div className={styles.error}>{error}</div>}

              <button className={styles.submitBtn} type="submit" disabled={loading}>
                {loading ? 'Регистрируем...' : 'Зарегистрироваться'}
              </button>
            </form>

            <div className={styles.skipRow}>
              <button className={styles.skipBtn} onClick={onDismiss} type="button">
                Пропустить
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className={styles.title}>Подтверждение email</h2>
            <p className={styles.desc}>
              Мы отправили 6-значный код на <strong>{email}</strong>.<br />
              Введите его ниже. Код действителен 15 минут.
            </p>
            <form onSubmit={handleVerify} className={styles.form}>
              <label className={styles.label}>
                Код из письма
                <input
                  className={`${styles.input} ${styles.codeInput}`}
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  required
                  disabled={loading}
                  autoFocus
                />
              </label>

              {error && <div className={styles.error}>{error}</div>}

              <button
                className={styles.submitBtn}
                type="submit"
                disabled={loading || code.length !== 6}
              >
                {loading ? 'Проверяем...' : 'Подтвердить'}
              </button>
            </form>

            <div className={styles.backRow}>
              <button
                className={styles.skipBtn}
                onClick={() => { setStep('form'); setError(''); setCode(''); }}
                type="button"
              >
                ← Назад
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
