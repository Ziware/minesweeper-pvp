import React, { useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useProfile, type GameRecord } from '../../hooks/useProfile';
import { useSettings } from '../../hooks/useSettings';
import { NavBar } from '../../components/NavBar/NavBar';
import { ActivityCalendar } from '../../components/ActivityCalendar/ActivityCalendar';
import styles from './ProfilePage.module.css';
import appStyles from '../../App.module.css';

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

function GameRow({ game, viewerUserId }: { game: GameRecord; viewerUserId: string | null }) {
  // Match by userId so login ≠ in-game name doesn't break the lookup.
  const viewer   = viewerUserId ? game.participants.find((p) => p.userId === viewerUserId) : null;
  const opponent = game.participants.find((p) => p.userId !== viewerUserId);
  const isWon    = viewer?.isWinner ?? false;

  return (
    <tr className={`${styles.gameRow} ${isWon ? styles.won : styles.lost}`}>
      <td>{formatDate(game.startedAt)}</td>
      <td>
        {opponent ? (
          opponent.isBot ? `🤖 ${opponent.name}` : (
            opponent.userId ? (
              <Link to={`/profile/${opponent.name}`} className={styles.opponentLink}>
                {opponent.name}
              </Link>
            ) : opponent.name
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
  const settingsApi = useSettings();

  const {
    profile, games, activity, total, totalPages, page, setPage,
    isLoading, error, isMe,
    updateProfile, uploadAvatar, deleteAvatar, deleteAccount,
    resendVerification, verifyEmailCode,
  } = useProfile(login ?? '', auth.user?.id, auth.token);

  // Edit mode state
  const [editing,      setEditing]      = useState(false);
  const [editBio,      setEditBio]      = useState('');
  const [editSaving,   setEditSaving]   = useState(false);
  const [editError,    setEditError]    = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Email verification modal state
  const [verifyModalOpen,  setVerifyModalOpen]  = useState(false);
  const [verifySending,    setVerifySending]    = useState(false);
  const [verifySubmitting, setVerifySubmitting] = useState(false);
  const [verifyCode,       setVerifyCode]       = useState('');
  const [verifyErrMsg,     setVerifyErrMsg]     = useState('');
  const [verifyDone,       setVerifyDone]       = useState(false);

  // Delete account dialog state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError,       setDeleteError]       = useState('');
  const [deleteInProgress,  setDeleteInProgress]  = useState(false);

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
      // Refresh auth state so the header avatar updates immediately
      await auth.refreshUser();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Ошибка загрузки аватара');
    }
  };

  const handleDeleteAvatar = useCallback(async () => {
    setEditError('');
    try {
      await deleteAvatar();
      await auth.refreshUser();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Ошибка удаления аватара');
    }
  }, [deleteAvatar, auth]);

  // Open the verify modal: send the code first, then show modal
  const handleOpenVerifyModal = async () => {
    if (!profile?.email) return;
    setVerifyErrMsg('');
    setVerifyCode('');
    setVerifySending(true);
    try {
      await resendVerification(profile.email);
      setVerifyModalOpen(true);
    } catch {
      setVerifyErrMsg('Ошибка отправки кода');
    } finally {
      setVerifySending(false);
    }
  };

  // Submit the code
  const handleSubmitVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.email || !verifyCode.trim()) return;
    setVerifySubmitting(true);
    setVerifyErrMsg('');
    try {
      const { token } = await verifyEmailCode(profile.email, verifyCode.trim());
      localStorage.setItem('auth_token', token);
      setVerifyModalOpen(false);
      setVerifyDone(true);
    } catch (err) {
      setVerifyErrMsg(err instanceof Error ? err.message : 'Неверный или истёкший код');
    } finally {
      setVerifySubmitting(false);
    }
  };

  // Resend from inside the modal
  const handleResendFromModal = async () => {
    if (!profile?.email) return;
    setVerifyErrMsg('');
    setVerifyCode('');
    setVerifySending(true);
    try {
      await resendVerification(profile.email);
    } catch {
      setVerifyErrMsg('Ошибка отправки кода');
    } finally {
      setVerifySending(false);
    }
  };

  // Delete account — called after confirmation
  const handleDeleteAccount = async () => {
    setDeleteInProgress(true);
    setDeleteError('');
    try {
      await deleteAccount();
      auth.logout();
      navigate('/');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Ошибка удаления аккаунта');
      setDeleteInProgress(false);
    }
  };

  // ── Shared header ────────────────────────────────────────────────────────────

  const renderHeader = () => (
    <NavBar auth={auth} settings={settingsApi} />
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className={appStyles.gameLayout}>
        {renderHeader()}
        <div className={styles.pageBody}>
          <div className={styles.page}>
            <div className={styles.loading}>Загрузка профиля…</div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className={appStyles.gameLayout}>
        {renderHeader()}
        <div className={styles.pageBody}>
          <div className={styles.page}>
            <div className={styles.error}>
              {error ?? 'Профиль не найден'}
              <br />
              <button className={styles.backBtn} onClick={() => navigate('/')}>← На главную</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const stats = profile.profile;
  const avatarLetter = profile.login.charAt(0).toUpperCase();

  return (
    <div className={appStyles.gameLayout}>
      {renderHeader()}
      <div className={styles.pageBody}>
      <div className={styles.page}>
      {/* Back link + account actions on the same row */}
      <div className={styles.topNav}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>← На главную</button>
        {isMe && (
          <>
            <button
              className={styles.logoutBtn}
              onClick={() => { auth.logout(); navigate('/'); }}
            >
              🚪 Выйти
            </button>
            <button
              className={styles.deleteAccountBtn}
              onClick={() => { setDeleteError(''); setShowDeleteConfirm(true); }}
            >
              🗑 Удалить аккаунт
            </button>
          </>
        )}
      </div>

      {/* Email verification banner (only for the owner) */}
      {isMe && profile.emailVerified === false && (
        <div className={styles.verifyBanner}>
          {verifyDone ? (
            <span className={styles.verifySent}>✓ Email подтверждён!</span>
          ) : (
            <>
              <span>⚠️ Email не подтверждён. Некоторые функции могут быть недоступны.</span>
              <button
                className={styles.verifyBtn}
                onClick={handleOpenVerifyModal}
                disabled={verifySending}
              >
                {verifySending ? '…' : 'Подтвердить'}
              </button>
              {verifyErrMsg && !verifyModalOpen && (
                <span className={styles.verifyErr}>{verifyErrMsg}</span>
              )}
            </>
          )}
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
              {stats?.avatarUrl && (
                <button
                  className={styles.deleteAvatarBtn}
                  onClick={handleDeleteAvatar}
                >
                  🗑 Удалить
                </button>
              )}
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
            ⭐ Рейтинг: {stats?.ratedGamesPlayed ? stats.rating : '—'}
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

        {/* Right column: activity calendar */}
        <div className={styles.activitySection}>
          <ActivityCalendar activity={activity} />
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
                    <GameRow key={g.id} game={g} viewerUserId={auth.user?.id ?? null} />
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

      {/* Delete account confirmation dialog */}
      {showDeleteConfirm && (
        <div className={styles.modalOverlay}>
          <div className={styles.confirmDialog}>
            <h3 className={styles.confirmTitle}>Удалить аккаунт?</h3>
            <p className={styles.confirmText}>
              Это действие необратимо. Все данные профиля будут удалены безвозвратно.
            </p>
            {deleteError && <p className={styles.confirmError}>{deleteError}</p>}
            <div className={styles.confirmActions}>
              <button
                className={styles.confirmDeleteBtn}
                onClick={handleDeleteAccount}
                disabled={deleteInProgress}
              >
                {deleteInProgress ? 'Удаление…' : '✓ Да, удалить'}
              </button>
              <button
                className={styles.confirmCancelBtn}
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteInProgress}
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email verification modal */}
      {verifyModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.confirmDialog}>
            <h3 className={styles.verifyModalTitle}>Подтверждение email</h3>
            <p className={styles.confirmText}>
              Мы отправили 6-значный код на <strong>{profile.email}</strong>.<br />
              Введите его ниже. Код действителен 15 минут.
            </p>
            <form onSubmit={handleSubmitVerifyCode} className={styles.verifyModalForm}>
              <label className={styles.verifyCodeLabel}>
                Код из письма
                <input
                  className={styles.verifyCodeInput}
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  placeholder="123456"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                  disabled={verifySubmitting}
                  autoFocus
                  required
                />
              </label>
              {verifyErrMsg && <p className={styles.confirmError}>{verifyErrMsg}</p>}
              <div className={styles.confirmActions}>
                <button
                  className={styles.saveBtn}
                  type="submit"
                  disabled={verifySubmitting || verifyCode.length !== 6}
                >
                  {verifySubmitting ? 'Проверяем…' : 'Подтвердить'}
                </button>
                <button
                  className={styles.confirmCancelBtn}
                  type="button"
                  onClick={() => { setVerifyModalOpen(false); setVerifyErrMsg(''); }}
                  disabled={verifySubmitting}
                >
                  Отмена
                </button>
              </div>
            </form>
            <div className={styles.verifyResendRow}>
              <button
                className={styles.verifyResendBtn}
                type="button"
                onClick={handleResendFromModal}
                disabled={verifySending || verifySubmitting}
              >
                {verifySending ? 'Отправляем…' : 'Отправить код снова'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
    </div>
  );
}
