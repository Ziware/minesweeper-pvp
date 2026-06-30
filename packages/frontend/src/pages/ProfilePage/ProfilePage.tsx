import React, { useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useProfile, type GameRecord } from '../../hooks/useProfile';
import styles from './ProfilePage.module.css';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}м ${sec}с` : `${sec}с`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' '
    + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function winPct(wins: number, total: number): string {
  if (!total) return '—';
  return `${Math.round((wins / total) * 100)}%`;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function GameRow({ game, viewerLogin }: { game: GameRecord; viewerLogin: string }) {
  const viewer = game.participants.find((p) => p.name === viewerLogin);
  const opponent = game.participants.find((p) => p.name !== viewerLogin);
  const isWon = viewer?.isWinner ?? false;

  return (
    <tr className={`${styles.gameRow} ${isWon ? styles.won : styles.lost}`}>
      <td>{formatDate(game.startedAt)}</td>
      <td>
        {opponent ? (
          opponent.isBot ? `🤖 ${opponent.name}` : (
            <Link to={`/profile/${opponent.name}`} className={styles.opponentLink}>
              {opponent.name}
            </Link>
          )
        ) : '—'}
      </td>
      <td>{game.mode === 'pvp' ? 'PvP' : 'Solo'}</td>
      <td>{game.turnsPlayed}</td>
      <td>{formatDuration(game.durationMs)}</td>
      <td className={isWon ? styles.winLabel : styles.lossLabel}>
        {isWon ? '✓ Победа' : '✗ Поражение'}
      </td>
    </tr>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ProfilePage() {
  const { login } = useParams<{ login: string }>();
  const navigate = useNavigate();
  const auth = useAuth();

  const {
    profile, games, total, totalPages, page, setPage,
    isLoading, error, isMe,
    updateProfile, uploadAvatar, resendVerification,
  } = useProfile(login ?? '', auth.user?.id, auth.token);

  // Edit mode state
  const [editing,      setEditing]      = useState(false);
  const [editBio,      setEditBio]      = useState('');
  const [editSaving,   setEditSaving]   = useState(false);
  const [editError,    setEditError]    = useState('');
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'sent' | 'error'>('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setEditBio(profile?.profile?.bio ?? '');
    setEditError('');
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const saveEdit = async () => {
    setEditSaving(true);
    setEditError('');
    try {
      await updateProfile(editBio.trim() || null);
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setEditSaving(false);
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setEditError('');
    try {
      await uploadAvatar(file);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Ошибка загрузки аватара');
    }
  };

  const handleResend = async () => {
    if (!profile?.email) return;
    try {
      await resendVerification(profile.email);
      setVerifyStatus('sent');
    } catch {
      setVerifyStatus('error');
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>Загрузка профиля…</div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className={styles.page}>
        <div className={styles.error}>
          {error ?? 'Профиль не найден'}
          <br />
          <button className={styles.backBtn} onClick={() => navigate('/')}>← На главную</button>
        </div>
      </div>
    );
  }

  const stats = profile.profile;
  const avatarLetter = profile.login.charAt(0).toUpperCase();

  return (
    <div className={styles.page}>
      {/* Back link */}
      <div className={styles.topNav}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>← На главную</button>
      </div>

      {/* Email verification banner (only for the owner) */}
      {isMe && profile.emailVerified === false && (
        <div className={styles.verifyBanner}>
          <span>⚠️ Email не подтверждён. Некоторые функции могут быть недоступны.</span>
          {verifyStatus === 'idle' && (
            <button className={styles.verifyBtn} onClick={handleResend}>Подтвердить</button>
          )}
          {verifyStatus === 'sent' && <span className={styles.verifySent}>Код отправлен на {profile.email}</span>}
          {verifyStatus === 'error' && <span className={styles.verifyErr}>Ошибка отправки</span>}
        </div>
      )}

      {/* Profile card */}
      <div className={styles.card}>
        {/* Avatar */}
        <div className={styles.avatarWrapper}>
          {stats?.avatarUrl ? (
            <img
              src={stats.avatarUrl}
              alt={profile.login}
              className={styles.avatar}
              onClick={() => isMe && editing && fileInputRef.current?.click()}
            />
          ) : (
            <div
              className={`${styles.avatarPlaceholder} ${isMe && editing ? styles.avatarClickable : ''}`}
              onClick={() => isMe && editing && fileInputRef.current?.click()}
            >
              {avatarLetter}
            </div>
          )}
          {isMe && editing && (
            <>
              <button
                className={styles.changeAvatarBtn}
                onClick={() => fileInputRef.current?.click()}
              >
                📷 Изменить
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleAvatarChange}
              />
            </>
          )}
        </div>

        {/* Info */}
        <div className={styles.info}>
          <h1 className={styles.login}>{profile.login}</h1>

          {isMe && profile.email && (
            <div className={styles.email}>
              📧 {profile.email}
              {profile.emailVerified ? ' ✓' : ' ✗'}
            </div>
          )}

          {editing ? (
            <textarea
              className={styles.bioInput}
              value={editBio}
              onChange={(e) => setEditBio(e.target.value)}
              maxLength={300}
              placeholder="Расскажите о себе…"
              rows={3}
            />
          ) : (
            stats?.bio && <p className={styles.bio}>{stats.bio}</p>
          )}

          <div className={styles.rating}>
            ⭐ Рейтинг: {stats?.rating ?? 1000}
          </div>

          {editError && <div className={styles.editError}>{editError}</div>}

          {isMe && !editing && (
            <button className={styles.editBtn} onClick={startEdit}>✏️ Редактировать</button>
          )}
          {isMe && editing && (
            <div className={styles.editActions}>
              <button className={styles.saveBtn} onClick={saveEdit} disabled={editSaving}>
                {editSaving ? 'Сохранение…' : '✓ Сохранить'}
              </button>
              <button className={styles.cancelBtn} onClick={cancelEdit} disabled={editSaving}>
                Отмена
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Stats grid */}
      {stats && (
        <div className={styles.statsGrid}>
          <StatCard label="Игр"    value={stats.gamesPlayed} />
          <StatCard label="Побед"  value={stats.wins} />
          <StatCard label="Win%"   value={winPct(stats.wins, stats.gamesPlayed)} />
          <StatCard label="Рейтинговых"   value={stats.ratedGamesPlayed} />
          <StatCard label="Рейт. побед"   value={stats.ratedWins} />
          <StatCard label="Рейт. Win%"    value={winPct(stats.ratedWins, stats.ratedGamesPlayed)} />
        </div>
      )}

      {/* Game history */}
      <section className={styles.history}>
        <h2 className={styles.historyTitle}>История игр ({total})</h2>
        {games.length === 0 ? (
          <p className={styles.noGames}>Игр пока нет</p>
        ) : (
          <>
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Соперник</th>
                    <th>Режим</th>
                    <th>Ходов</th>
                    <th>Длительность</th>
                    <th>Итог</th>
                  </tr>
                </thead>
                <tbody>
                  {games.map((g) => (
                    <GameRow key={g.id} game={g} viewerLogin={profile.login} />
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className={styles.pagination}>
                <button
                  className={styles.pageBtn}
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  ← Пред
                </button>
                <span className={styles.pageInfo}>Страница {page} / {totalPages}</span>
                <button
                  className={styles.pageBtn}
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  След →
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
