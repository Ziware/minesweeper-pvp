import React, { useState } from 'react';
import { ApiError } from '../../hooks/useAuth';
import styles from './Auth.module.css';

interface LoginModalProps {
  onLogin:        (emailOrLogin: string, password: string) => Promise<void>;
  onSwitchToRegister: () => void;
  onClose:        () => void;
}

export function LoginModal({ onLogin, onSwitchToRegister, onClose }: LoginModalProps) {
  const [emailOrLogin, setEmailOrLogin] = useState('');
  const [password,     setPassword]     = useState('');
  const [error,        setError]        = useState('');
  const [loading,      setLoading]      = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onLogin(emailOrLogin.trim(), password);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Закрыть">✕</button>
        <h2 className={styles.title}>Вход</h2>

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            Email или логин
            <input
              className={styles.input}
              type="text"
              value={emailOrLogin}
              onChange={(e) => setEmailOrLogin(e.target.value)}
              autoComplete="username"
              required
              disabled={loading}
            />
          </label>

          <label className={styles.label}>
            Пароль
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              disabled={loading}
            />
          </label>

          {error && <div className={styles.error}>{error}</div>}

          <button className={styles.submitBtn} type="submit" disabled={loading}>
            {loading ? 'Входим...' : 'Войти'}
          </button>
        </form>

        <div className={styles.switchRow}>
          Нет аккаунта?{' '}
          <button className={styles.switchBtn} onClick={onSwitchToRegister} type="button">
            Зарегистрироваться
          </button>
        </div>
      </div>
    </div>
  );
}
