import React, { useState, useRef, useEffect } from 'react';
import type { AuthApi } from '../../hooks/useAuth';
import { LoginModal }    from '../Auth/LoginModal';
import { RegisterModal } from '../Auth/RegisterModal';
import styles from './ProfileButton.module.css';

interface ProfileButtonProps {
  auth: AuthApi;
}

type Modal = 'none' | 'login' | 'register';

export function ProfileButton({ auth }: ProfileButtonProps) {
  const [modal,       setModal]       = useState<Modal>('none');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  if (auth.isLoading) {
    return <div className={styles.skeleton} />;
  }

  const initials = auth.user
    ? auth.user.login.slice(0, 2).toUpperCase()
    : null;

  return (
    <>
      <div className={styles.anchor} ref={dropdownRef}>
        {auth.isGuest ? (
          <button
            className={styles.guestBtn}
            onClick={() => setModal('login')}
            title="Войти или зарегистрироваться"
          >
            👤 Войти
          </button>
        ) : (
          <button
            className={styles.avatarBtn}
            onClick={() => setDropdownOpen((o) => !o)}
            title={auth.user!.login}
            aria-expanded={dropdownOpen}
          >
            <span className={styles.initials}>{initials}</span>
          </button>
        )}

        {dropdownOpen && auth.user && (
          <div className={styles.dropdown}>
            <div className={styles.dropdownUser}>
              <span className={styles.dropdownLogin}>{auth.user.login}</span>
              <span className={styles.dropdownEmail}>{auth.user.email}</span>
              {!auth.user.emailVerified && (
                <span className={styles.unverifiedBadge}>⚠️ Email не подтверждён</span>
              )}
            </div>
            <div className={styles.dropdownDivider} />
            <button
              className={styles.dropdownLogout}
              onClick={() => { auth.logout(); setDropdownOpen(false); }}
            >
              🚪 Выйти
            </button>
          </div>
        )}
      </div>

      {modal === 'login' && (
        <LoginModal
          onLogin={auth.login}
          onSwitchToRegister={() => setModal('register')}
          onClose={() => setModal('none')}
        />
      )}

      {modal === 'register' && (
        <RegisterModal
          onRegister={auth.register}
          onVerifyEmail={auth.verifyEmail}
          onSwitchToLogin={() => setModal('login')}
          onClose={() => setModal('none')}
          onSkipVerification={async (email, password) => {
            try {
              await auth.login(email, password);
              setModal('none');
            } catch {
              // ignore — user can try again from login modal
              setModal('login');
            }
          }}
        />
      )}
    </>
  );
}
