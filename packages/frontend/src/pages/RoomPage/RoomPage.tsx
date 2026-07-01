import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameSession } from '../../context/GameSessionContext';
import { useAuth } from '../../hooks/useAuth';
import { useSettings } from '../../hooks/useSettings';
import { useSound } from '../../hooks/useSound';
import { NavBar } from '../../components/NavBar/NavBar';
import { Board, MobileInputMode } from '../../components/Board/Board';
import { GameInfo, SideNotice, describeLastAction } from '../../components/GameInfo/GameInfo';
import { HelpModal } from '../../components/HelpModal/HelpModal';
import { PostGameRegisterPrompt } from '../../components/PostGameRegisterPrompt/PostGameRegisterPrompt';
import { SurrenderButton } from '../../components/SurrenderButton/SurrenderButton';
import styles from './RoomPage.module.css';

export function RoomPage() {
  const { roomId: urlRoomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const auth = useAuth();
  const settingsApi = useSettings();
  const {
    settings,
    mutedRef,
    volumeRef,
    toggleMuted,
    setVolume,
    toggleHideControls,
    toggleFlagClickDefuse,
  } = settingsApi;
  const { muted, hideControls, volume, flagClickDefuse } = settings;
  const { play, playDelayed, preload } = useSound({ mutedRef, volumeRef });

  const session = useGameSession();
  const {
    screen,
    roomId,
    myColor,
    myName,
    gameState,
    gameOver,
    errorMsg,
    serverReachable,
    isBotGame,
    placeMineSetup,
    confirmSetup,
    selectZone,
    captureCell,
    defuseCell,
    chord,
    endPhase2,
    endPhase3,
    placeMinePhase3,
    toggleMark,
    showLocalError,
    returnToMenu,
    leaveRoom,
    joinRoom,
    surrender,
  } = session;

  // ── UI state ────────────────────────────────────────────────────────────────
  const [showHelp, setShowHelp] = useState(false);
  const [showRegisterPrompt, setShowRegisterPrompt] = useState(false);
  const [boardHeight, setBoardHeight] = useState<number | null>(null);
  const [inviteUrlCopied, setInviteUrlCopied] = useState(false);
  const [mobileInputMode, setMobileInputMode] = useState<MobileInputMode>('normal');

  // ── Side notice ─────────────────────────────────────────────────────────────
  const [sideNotice, setSideNotice] = useState<SideNotice | null>(null);
  const sideNoticeTimerRef = useRef<number | null>(null);
  const sideNoticeNonceRef = useRef<number>(0);
  const pushSideNotice = (text: string, tone: SideNotice['tone']) => {
    sideNoticeNonceRef.current += 1;
    setSideNotice({ text, tone, nonce: sideNoticeNonceRef.current });
    if (sideNoticeTimerRef.current !== null) {
      window.clearTimeout(sideNoticeTimerRef.current);
    }
    sideNoticeTimerRef.current = window.setTimeout(() => {
      setSideNotice(null);
      sideNoticeTimerRef.current = null;
    }, 5000);
  };

  // ── Sound refs ──────────────────────────────────────────────────────────────
  const previousLivesRef = useRef<Record<string, number> | null>(null);
  const previousCapturedCountRef = useRef<number | null>(null);
  const previousActionKeyRef = useRef<string | null>(null);
  const previousTurnKeyRef = useRef<string | null>(null);
  const previousDefusesUsedRef = useRef<number | null>(null);
  const previousMinesPlacedRef = useRef<number | null>(null);
  const previousWinnerColorRef = useRef<string | null>(null);
  const previousDefusesPerTurnRef = useRef<number | null>(null);
  const previousPhaseRef = useRef<string | null>(null);
  const previousMinesAllowedNoticeRef = useRef<string | null>(null);
  const primaryActionRef = useRef<(() => void) | null>(null);

  const lowTimeFiredRef = useRef<Record<'red' | 'blue', boolean>>({
    red: false,
    blue: false,
  });

  const playButton = () => play('button');
  const closeHelp = () => setShowHelp(false);

  primaryActionRef.current = null;

  // ── Redirect to lobby only when there is no URL room to join ────────────────
  useEffect(() => {
    if (screen === 'lobby' && !urlRoomId) {
      navigate('/', { replace: true });
    }
  }, [screen, urlRoomId, navigate]);

  // ── Preload sounds ──────────────────────────────────────────────────────────
  useEffect(() => { preload(); }, [preload]);

  // ── Space hotkey ────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const target = e.target as HTMLElement | null;
      if (target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )) return;
      if (showHelp) return;
      if (!primaryActionRef.current) return;
      e.preventDefault();
      primaryActionRef.current();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showHelp]);

  // ── Mobile input mode guard ─────────────────────────────────────────────────
  useEffect(() => {
    if (mobileInputMode === 'normal') return;
    if (!gameState) return;
    const phase = gameState.turn.phase;
    const finished = phase === 'finished' || !!gameState.winnerColor;
    const myTurn = gameState.turn.currentPlayer === myColor;
    const flagOk = !finished && phase === 'phase2';
    const defuseOk = !finished && phase === 'phase2' && myTurn;
    if (mobileInputMode === 'flag' && !flagOk) setMobileInputMode('normal');
    if (mobileInputMode === 'defuse' && !defuseOk) setMobileInputMode('normal');
  }, [gameState, myColor, mobileInputMode]);

  // ── Victory/defeat sound ────────────────────────────────────────────────────
  useEffect(() => {
    if (!gameState) return;
    const winner = gameState.winnerColor ?? null;
    const prev = previousWinnerColorRef.current;
    if (winner && !prev) {
      if (myColor && winner === myColor) {
        playDelayed('victory', 500);
      } else {
        playDelayed('defeat', 500);
      }
    }
    previousWinnerColorRef.current = winner;
  }, [gameState, myColor, playDelayed]);

  // ── Game event sounds + side notices ────────────────────────────────────────
  useEffect(() => {
    if (!gameState) return;

    const currentLives = Object.fromEntries(
      gameState.players.map((player) => [player.color, player.lives])
    );
    const previousLives = previousLivesRef.current;
    const turn = gameState.turn;
    const phase = turn.phase;
    const turnKey = `${turn.currentPlayer}:${turn.turnsPlayed}`;
    const turnChanged = previousTurnKeyRef.current !== turnKey;
    const lastAction = turn.lastAction;
    const actionKey = lastAction
      ? `${turnKey}:${lastAction.type}:${lastAction.actorColor}`
      : null;
    const actionChanged = actionKey !== previousActionKeyRef.current;

    const livesDecreased = previousLives
      ? gameState.players.some(
        (player) => player.lives < (previousLives[player.color] ?? player.lives)
      )
      : false;
    const isExplosionAction = lastAction?.type === 'mine_exploded';
    const hasExplosion =
      livesDecreased &&
      isExplosionAction &&
      actionChanged &&
      (phase === 'phase2' || phase === 'phase3' || phase === 'finished');

    const capturedCount = turn.capturedThisTurn.length;
    const previousCaptured = previousCapturedCountRef.current;
    const newCellsCaptured =
      !turnChanged &&
      previousCaptured !== null &&
      capturedCount > previousCaptured &&
      (phase === 'phase2' || phase === 'phase3');

    const defusesUsed = turn.defusesUsedThisTurn;
    const previousDefusesUsed = previousDefusesUsedRef.current;
    const newDefuse =
      !turnChanged &&
      previousDefusesUsed !== null &&
      defusesUsed > previousDefusesUsed;

    const minesPlaced = turn.minesPlacedThisTurn;

    if (hasExplosion) {
      play('explosion');
    } else if (newDefuse) {
      play('disarm');
    } else if (newCellsCaptured) {
      play('locked_cell');
    }

    if (actionChanged && lastAction && myColor) {
      const { text, tone } = describeLastAction(lastAction, myColor);
      pushSideNotice(text, tone);
    }

    const prevDefusesPerTurn = previousDefusesPerTurnRef.current;
    const defusesPerTurn = turn.defusesPerTurn;
    if (prevDefusesPerTurn !== null && defusesPerTurn > prevDefusesPerTurn) {
      const delta = defusesPerTurn - prevDefusesPerTurn;
      playDelayed('add_defuse', 300);
      pushSideNotice(
        `🔧 +${delta} к лимиту разминирований на ход для обоих игроков!`,
        'success',
      );
    }

    const isMyTurn = turn.currentPlayer === myColor;
    const phase3Bonus = turn.minesAllowedThisTurn - gameState.config.minesPerTurn;
    const bonusKey = `${turnKey}:phase3-bonus`;
    if (
      phase === 'phase3' &&
      isMyTurn &&
      phase3Bonus > 0 &&
      previousMinesAllowedNoticeRef.current !== bonusKey
    ) {
      previousMinesAllowedNoticeRef.current = bonusKey;
      pushSideNotice(
        `💣 Зона над штабом противника: +${phase3Bonus} к лимиту мин на этот ход!`,
        'success',
      );
    }

    previousLivesRef.current = currentLives;
    previousCapturedCountRef.current = capturedCount;
    previousActionKeyRef.current = actionKey;
    previousTurnKeyRef.current = turnKey;
    previousDefusesUsedRef.current = defusesUsed;
    previousMinesPlacedRef.current = minesPlaced;
    previousDefusesPerTurnRef.current = defusesPerTurn;
    previousPhaseRef.current = phase;
  }, [gameState, myColor, play, playDelayed]);

  // ── Low-time sound ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!gameState) return;
    const turn = gameState.turn;
    if (turn.phase === 'finished' || gameState.winnerColor) return;
    if (turn.currentTurnStartedAtMs === null) return;

    const LOW_TIME_MS = 60_000;

    const checkAndFire = () => {
      const offset = turn.serverNowMs - Date.now();
      const now = Date.now() + offset;
      for (const player of gameState.players) {
        const isActive = player.color === turn.currentPlayer;
        const elapsed = isActive
          ? Math.max(0, now - (turn.currentTurnStartedAtMs ?? now))
          : 0;
        const remaining = Math.max(0, player.timeMs - elapsed);
        const color = player.color;
        if (!Number.isFinite(player.timeMs)) {
          lowTimeFiredRef.current[color] = false;
          continue;
        }
        if (remaining < LOW_TIME_MS) {
          if (!lowTimeFiredRef.current[color]) {
            lowTimeFiredRef.current[color] = true;
            play('low_timer');
          }
        } else {
          lowTimeFiredRef.current[color] = false;
        }
      }
    };

    checkAndFire();
    const id = window.setInterval(checkAndFire, 250);
    return () => window.clearInterval(id);
  }, [gameState, play]);

  // ── Register prompt on game over ────────────────────────────────────────────
  useEffect(() => {
    if (gameOver && auth.isGuest) {
      setShowRegisterPrompt(true);
    }
  }, [gameOver, auth.isGuest]);

  // ── Reset on room change ────────────────────────────────────────────────────
  useEffect(() => {
    lowTimeFiredRef.current = { red: false, blue: false };
    setSideNotice(null);
    if (sideNoticeTimerRef.current !== null) {
      window.clearTimeout(sideNoticeTimerRef.current);
      sideNoticeTimerRef.current = null;
    }
    previousDefusesPerTurnRef.current = null;
    previousMinesAllowedNoticeRef.current = null;
    previousPhaseRef.current = null;
  }, [roomId]);

  // ── Helper renderers ────────────────────────────────────────────────────────
  const renderErrorToast = () => (
    errorMsg ? <div className={styles.toastError}>{errorMsg}</div> : null
  );

  const renderOfflineBanner = () => (
    !serverReachable ? (
      <div className={styles.offlineBanner}>
        ⚠️ Сервер недоступен. Пытаемся переподключиться…
      </div>
    ) : null
  );

  const renderMobileNoticeToast = () => {
    if (!sideNotice) return null;
    const toneClass = sideNotice.tone === 'danger'  ? styles.toastNoticeDanger
                    : sideNotice.tone === 'warning' ? styles.toastNoticeWarning
                    : '';
    return (
      <div
        key={`mobile-notice-${sideNotice.nonce}`}
        className={`${styles.toastNotice} ${toneClass}`}
      >
        {sideNotice.text}
      </div>
    );
  };

  const renderShell = (content: React.ReactNode, centerContent?: React.ReactNode, showHelpBtn = false) => (
    <div className={styles.gameLayout}>
      <NavBar
        auth={auth}
        settings={settingsApi}
        onHelpOpen={showHelpBtn ? () => setShowHelp(true) : undefined}
        centerContent={centerContent}
        hideNavLinks={!!centerContent}
      />
      {content}
      {renderErrorToast()}
      {renderMobileNoticeToast()}
      {renderOfflineBanner()}
      {showHelp && <HelpModal onClose={closeHelp} />}
      {showRegisterPrompt && auth.isGuest && myColor && (
        <PostGameRegisterPrompt
          sessionId={gameOver?.sessionId ?? ''}
          color={myColor}
          auth={auth}
          onDismiss={() => setShowRegisterPrompt(false)}
        />
      )}
    </div>
  );

  // ── Join-from-invite screen (visited /room/:id with no active game) ──────────
  if (screen === 'lobby' && urlRoomId) {
    return renderShell(
      <div className={styles.centered}>
        <div className={styles.waitCard}>
          <h2>🎮 Присоединиться к игре</h2>
          <p>Комната <strong>{urlRoomId}</strong></p>
          <button
            type="button"
            className={styles.waitLeaveBtn}
            style={{ background: '#1a4f80', color: '#7af', borderColor: '#2a5f90', alignSelf: 'center' }}
            onClick={() => {
              if (auth.isGuest) {
                joinRoom(urlRoomId, 'Гость');
              } else {
                joinRoom(urlRoomId, auth.user?.login ?? 'Игрок');
              }
            }}
          >
            Войти в комнату
          </button>
          <button
            type="button"
            className={styles.waitLeaveBtn}
            onClick={() => navigate('/', { replace: true })}
          >
            ← В главное меню
          </button>
        </div>
      </div>
    );
  }

  // ── Waiting screen ──────────────────────────────────────────────────────────
  if (screen === 'waiting') {
    const inviteUrl = `${window.location.origin}/room/${roomId}`;

    const copyInviteUrl = async (e?: React.MouseEvent<HTMLButtonElement>) => {
      e?.currentTarget?.blur();
      try {
        await navigator.clipboard.writeText(inviteUrl);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = inviteUrl;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch { /* без копии */ }
        document.body.removeChild(ta);
      }
      setInviteUrlCopied(true);
      window.setTimeout(() => setInviteUrlCopied(false), 700);
    };

    return renderShell(
      <div className={styles.centered}>
        <div className={styles.waitCard}>
          <h2>⏳ Ожидание противника...</h2>
          <p>Пригласительная ссылка:</p>
          <button
            type="button"
            className={`${styles.inviteUrlCopy} ${inviteUrlCopied ? styles.inviteUrlCopied : ''}`}
            onClick={(e) => copyInviteUrl(e)}
            title={inviteUrlCopied ? 'Скопировано!' : 'Нажмите, чтобы скопировать'}
            aria-label="Скопировать ссылку-приглашение"
          >
            <span className={styles.inviteUrl}>{inviteUrl}</span>
            <span className={styles.inviteUrlOverlay} aria-hidden="true">
              {inviteUrlCopied ? '✓ Скопировано!' : '📋 Скопировать'}
            </span>
          </button>
          <p className={styles.copyHintMobile}>👆 Нажмите на ссылку, чтобы скопировать</p>
          <button
            type="button"
            className={styles.waitLeaveBtn}
            onClick={() => leaveRoom()}
          >
            ← Выйти в меню
          </button>
        </div>
      </div>
    );
  }

  // ── Game / setup / finished screen ─────────────────────────────────────────
  if (
    (screen === 'game' || screen === 'finished' || screen === 'setup') &&
    gameState &&
    myColor
  ) {
    const me       = gameState.players.find((p) => p.color === myColor);
    const opponent = gameState.players.find((p) => p.color !== myColor);

    const turn = gameState.turn;
    const isMyTurn = turn.currentPlayer === myColor;
    const isFinished = turn.phase === 'finished' || !!gameState.winnerColor;
    const isSetup = turn.phase === 'setup';

    type PrimaryAction = {
      label: string;
      onClick: () => void;
      variant?: 'menu' | 'endTurn' | 'disabledHint';
      disabled?: boolean;
    };

    let primaryAction: PrimaryAction = {
      label: isMyTurn ? 'Нет действия' : 'Ход противника',
      onClick: () => {},
      disabled: true,
      variant: 'disabledHint',
    };

    if (isFinished) {
      primaryAction = {
        label: '← Вернуться в меню',
        onClick: () => returnToMenu(),
        variant: 'menu',
      };
    } else if (isSetup && me && !me.setupConfirmed) {
      const myInitialMines = me.color === 'red'
        ? gameState.config.initialMinesRed
        : gameState.config.initialMinesBlue;
      const remaining = myInitialMines - me.minesPlaced;
      const canConfirm = remaining === 0;
      primaryAction = {
        label: canConfirm
          ? 'Подтвердить ✓'
          : `Поставьте ещё ${remaining} мин${remaining === 1 ? 'у' : remaining >= 2 && remaining <= 4 ? 'ы' : ''}`,
        onClick: () => {
          if (!canConfirm) return;
          playButton();
          confirmSetup();
        },
        disabled: !canConfirm,
        variant: canConfirm ? undefined : 'disabledHint',
      };
    } else if (isMyTurn && turn.phase === 'phase2') {
      primaryAction = {
        label: 'Завершить захват →',
        onClick: () => {
          playButton();
          endPhase2();
        },
      };
    } else if (isMyTurn && turn.phase === 'phase3') {
      primaryAction = {
        label: 'Передать ход →',
        onClick: () => {
          playButton();
          endPhase3();
        },
        variant: 'endTurn',
      };
    }

    primaryActionRef.current = primaryAction.disabled ? null : primaryAction.onClick;

    const renderPrimaryActionButton = () => (
      <button
        className={`${styles.primaryActionBtn} ${
          primaryAction.variant === 'menu' ? styles.menuVariant : ''
        } ${
          primaryAction.variant === 'endTurn' ? styles.endTurnVariant : ''
        } ${
          primaryAction.variant === 'disabledHint' ? styles.disabledHintVariant : ''
        }`}
        onClick={primaryAction.onClick}
        disabled={!!primaryAction.disabled}
      >
        {primaryAction.label}
      </button>
    );

    const headerContent = (
      <>
        <div className={styles.headerPlayersRow}>
          <span
            className={styles.playerBadge}
            style={{ borderColor: myColor === 'red' ? '#e74c3c' : '#3498db' }}
          >
            {myColor === 'red' ? '🔴' : '🔵'} {me?.name ?? myName}
          </span>
          <span className={styles.vs}>vs</span>
          <span
            className={styles.playerBadge}
            style={{ borderColor: opponent?.color === 'red' ? '#e74c3c55' : '#3498db55' }}
          >
            {opponent?.color === 'red' ? '🔴' : '🔵'} {isBotGame ? '🤖 ' : ''}{opponent?.name ?? '...'}
          </span>
        </div>
      </>
    );

    const leftColumnStyle = boardHeight ? { height: boardHeight } : undefined;

    const boardWrapperRefSetter = (el: HTMLDivElement | null) => {
      if (!el) return;
      if ((el as any).__roAttached) return;
      (el as any).__roAttached = true;
      const update = () => {
        const h = el.getBoundingClientRect().height;
        if (h) setBoardHeight((prev) => (prev === h ? prev : h));
      };
      update();
      const ro = new ResizeObserver(update);
      ro.observe(el);
    };

    return renderShell(
      <div className={styles.gameBody}>
        {/* Desktop left column */}
        <div
          className={`${styles.sideColumn} ${styles.sideColumnLeft} ${styles.desktopOnly}`}
          style={leftColumnStyle}
        >
          <GameInfo
            gameState={gameState}
            myColor={myColor}
            section="controls"
            gameOver={gameOver}
            hideControls={hideControls}
            sideNotice={sideNotice}
          />
          <div className={styles.actionButtonSlot}>
            {renderPrimaryActionButton()}
            {!isFinished && (
              <SurrenderButton onSurrender={surrender} />
            )}
          </div>
        </div>

        {/* Mobile red banner */}
        <div className={`${styles.mobileBanner} ${styles.mobileBannerRed} ${styles.mobileOnly}`}>
          <GameInfo
            gameState={gameState}
            myColor={myColor}
            section="banner"
            bannerColor="red"
            gameOver={gameOver}
          />
        </div>

        <div className={styles.boardSlot}>
          <Board
            gameState={gameState}
            myColor={myColor}
            mobileInputMode={mobileInputMode}
            flagClickDefuse={flagClickDefuse}
            onWrapperRef={boardWrapperRefSetter}
            onSelectZone={(row, col) => {
              play('scan');
              selectZone(row, col);
            }}
            onCaptureCell={(row, col) => {
              captureCell(row, col);
            }}
            onDefuseCell={(row, col) => {
              defuseCell(row, col);
            }}
            onPlaceMinePhase3={(row, col) => {
              play('plant_mine');
              placeMinePhase3(row, col);
            }}
            onPlaceMineSetup={(row, col) => {
              play('plant_mine');
              placeMineSetup(row, col);
            }}
            onToggleMark={(row, col, mark) => {
              playButton();
              toggleMark(row, col, mark);
            }}
            onChord={(row, col) => {
              chord(row, col);
            }}
            onLocalError={(message) => {
              showLocalError(message);
            }}
          />
        </div>

        {/* Mobile blue banner */}
        <div className={`${styles.mobileBanner} ${styles.mobileBannerBlue} ${styles.mobileOnly}`}>
          <GameInfo
            gameState={gameState}
            myColor={myColor}
            section="banner"
            bannerColor="blue"
            gameOver={gameOver}
          />
        </div>

        {/* Mobile action slot */}
        {(() => {
          const flagEnabled   = !isFinished && turn.phase === 'phase2';
          const defuseEnabled = !isFinished && turn.phase === 'phase2' && isMyTurn;
          return (
            <div className={`${styles.actionButtonSlot} ${styles.mobileActionSlot} ${styles.mobileOnly}`}>
              <div className={styles.mobileModeRow}>
                <button
                  type="button"
                  className={`${styles.mobileModeBtn} ${mobileInputMode === 'flag' ? styles.mobileModeBtnActive : ''}`}
                  onClick={() => setMobileInputMode((m) => (m === 'flag' ? 'normal' : 'flag'))}
                  aria-pressed={mobileInputMode === 'flag'}
                  disabled={!flagEnabled}
                  title="Режим флажков / вопросов (как ПКМ)"
                >
                  🚩 Флаг
                </button>
                <button
                  type="button"
                  className={`${styles.mobileModeBtn} ${mobileInputMode === 'defuse' ? styles.mobileModeBtnActive : ''}`}
                  onClick={() => setMobileInputMode((m) => (m === 'defuse' ? 'normal' : 'defuse'))}
                  aria-pressed={mobileInputMode === 'defuse'}
                  disabled={!defuseEnabled}
                  title="Режим разминирования (как Ctrl+ЛКМ)"
                >
                  🔧 Разминировать
                </button>
              </div>
              {renderPrimaryActionButton()}
              {!isFinished && (
                <SurrenderButton onSurrender={surrender} />
              )}
            </div>
          );
        })()}

        {/* Mobile controls block */}
        <div className={`${styles.sideColumn} ${styles.mobileControls} ${styles.mobileOnly}`}>
          <GameInfo
            gameState={gameState}
            myColor={myColor}
            section="controls"
            gameOver={gameOver}
            hideControls={hideControls}
            sideNotice={sideNotice}
          />
        </div>

        {/* Stats column */}
        <div className={styles.sideColumn}>
          <GameInfo
            gameState={gameState}
            myColor={myColor}
            section="stats"
            hideControls={hideControls}
          />
        </div>
      </div>,
      headerContent,
      true /* showHelpBtn */
    );
  }

  // ── Restoring / loading state ───────────────────────────────────────────────
  return renderShell(
    <div className={styles.centered}>
      <div className={styles.waitCard}>
        <p>⏳ Загрузка игры…</p>
      </div>
    </div>
  );
}
