import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../Icon/Icon';
import { ProfileButton } from '../ProfileButton/ProfileButton';
import { SettingsMenu } from '../SettingsMenu/SettingsMenu';
import type { AuthApi } from '../../hooks/useAuth';
import type { SettingsApi } from '../../hooks/useSettings';
import styles from './NavBar.module.css';

interface NavBarProps {
  auth: AuthApi;
  settings: SettingsApi;
  onHelpOpen?: () => void;
}

export function NavBar({ auth, settings, onHelpOpen }: NavBarProps) {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <nav className={styles.navbar}>
      {/* Left: logo */}
      <Link to="/" className={styles.logo}>
        <Icon name="headquarters" size="1.6em" />
        <span className={styles.logoText}>MsPvP</span>
      </Link>

      {/* Center: nav links (desktop only) */}
      <div className={styles.navLinks}>
        <Link to="/rules" className={styles.navLink}>Правила</Link>
        <Link to="/classic" className={styles.navLink}>Классика</Link>
      </div>

      {/* Right: actions */}
      <div className={styles.actions}>
        {onHelpOpen && (
          <button className={styles.actionBtn} onClick={onHelpOpen} title="Правила (подсказка)">
            ❓<span className={styles.actionBtnLabel}> Правила</span>
          </button>
        )}

        <div className={styles.settingsAnchor} data-settings-anchor>
          <button
            className={`${styles.actionBtn} ${showSettings ? styles.actionBtnActive : ''}`}
            onClick={() => setShowSettings((v) => !v)}
            aria-expanded={showSettings}
            aria-haspopup="menu"
            title="Настройки"
          >
            ⚙️<span className={styles.actionBtnLabel}> Настройки</span>
          </button>
          {showSettings && (
            <SettingsMenu
              muted={settings.settings.muted}
              volume={settings.settings.volume}
              hideControls={settings.settings.hideControls}
              flagClickDefuse={settings.settings.flagClickDefuse}
              onToggleMuted={settings.toggleMuted}
              onVolumeChange={settings.setVolume}
              onToggleHideControls={settings.toggleHideControls}
              onToggleFlagClickDefuse={settings.toggleFlagClickDefuse}
              onClose={() => setShowSettings(false)}
            />
          )}
        </div>

        <ProfileButton auth={auth} />
      </div>
    </nav>
  );
}
