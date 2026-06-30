import React, { useState } from 'react';
import { ApiError } from '../../hooks/useAuth';
import styles from './Auth.module.css';

interface RegisterModalProps {
  onRegister:          (email: string, login: string, password: string) => Promise<void>;
  onVerifyEmail:       (email: string, code: string) => Promise<void>;
  onSwitchToLogin:     () => void;
  onClose:             () => void;
  /** Called when user skips email verification and wants to log in right away */
  onSkipVerification?: (email: string, password: string) => void;
}

type Step = 'form' | 'verify';

export function RegisterModal({
  onRegister,
  onVerifyEmail,
  onSwitchToLogin,
  onClose,
  onSkipVerification,
}: RegisterModalProps) {
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
      await onRegister(email.trim(), login.trim(), password);
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
      await onVerifyEmail(email.trim(), code.trim());
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Неверный код');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Закрыть">✕</button>

        {step === 'form' ? (
          <>
            <h2 className={styles.title}>Регистрация</h2>
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

            <div className={styles.switchRow}>
              Уже есть аккаунт?{' '}
              <button className={styles.switchBtn} onClick={onSwitchToLogin} type="button">
                Войти
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className={styles.title}>Подтверждение email</h2>
            <p className={styles.verifyDesc}>
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

              <button className={styles.submitBtn} type="submit" disabled={loading || code.length !== 6}>
                {loading ? 'Проверяем...' : 'Подтвердить'}
              </button>
            </form>

            <div className={styles.switchRow}>
              <button
                className={styles.switchBtn}
                onClick={() => { setStep('form'); setError(''); setCode(''); }}
                type="button"
              >
                ← Назад
              </button>
              {onSkipVerification && (
                <button
                  className={styles.switchBtn}
                  onClick={() => onSkipVerification(email.trim(), password)}
                  type="button"
                >
                  Войти без подтверждения →
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
