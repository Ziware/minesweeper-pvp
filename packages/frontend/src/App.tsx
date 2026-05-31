import React, { useEffect, useRef, useState } from 'react';
import { useSocket } from './hooks/useSocket';
import { useSound } from './hooks/useSound';
import { useSettings } from './hooks/useSettings';
import { Lobby }     from './components/Lobby/Lobby';
import { Board, MobileInputMode } from './components/Board/Board';
import { GameInfo }  from './components/GameInfo/GameInfo';
import { HelpModal } from './components/HelpModal/HelpModal';
import { SettingsMenu } from './components/SettingsMenu/SettingsMenu';
import { Icon } from './components/Icon/Icon';
import styles from './App.module.css';

export default function App() {
  const {
    screen, roomId, myColor, myName, gameState, errorMsg, gameOver, serverReachable,
    createRoom, joinRoom,
    placeMineSetup, confirmSetup,
    selectZone, captureCell, defuseCell, chord, endPhase2, endPhase3, placeMinePhase3, toggleMark,
    showLocalError,
    returnToMenu, leaveRoom,
  } = useSocket();

  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [boardHeight, setBoardHeight] = useState<number | null>(null);
  const [roomIdCopied, setRoomIdCopied] = useState(false);
  // Залипающие кнопки на мобиле: 'flag' (тап = ПКМ-цикл),
  // 'defuse' (тап = Ctrl+ЛКМ). 'normal' — выключены обе.
  const [mobileInputMode, setMobileInputMode] = useState<MobileInputMode>('normal');

  const {
    settings,
    mutedRef,
    volumeRef,
    toggleMuted,
    setVolume,
    toggleHideControls,
  } = useSettings();
  const { muted, hideControls, volume } = settings;

  const { play, playDelayed, preload } = useSound({ mutedRef, volumeRef });

  const previousLivesRef = useRef<Record<string, number> | null>(null);
  const previousCapturedCountRef = useRef<number | null>(null);
  const previousActionKeyRef = useRef<string | null>(null);
  const previousTurnKeyRef = useRef<string | null>(null);
  const previousDefusesUsedRef = useRef<number | null>(null);
  const previousMinesPlacedRef = useRef<number | null>(null);
  const previousWinnerColorRef = useRef<string | null>(null);
  const primaryActionRef = useRef<(() => void) | null>(null);

  const playButton = () => play('button');
  const closeHelp = () => {
    playButton();
    setShowHelp(false);
  };

  // Сбрасываем hotkey-действие на каждом рендере; конкретный экран ниже
  // может переустановить его. Это гарантирует, что Space не сработает,
  // когда нет видимой кнопки слева от доски (лобби, ожидание, setup).
  primaryActionRef.current = null;

  // Глобальный hotkey Space — нажимает основную кнопку слева от доски
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      // Не перехватывать в input/textarea/contenteditable
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

  useEffect(() => {
    preload();
  }, [preload]);

  // Если режим (флаг/разминирование) стал недоступен — гасим.
  // Условия доступности дублируют логику кнопок ниже; держим тут,
  // чтобы поведение Board (mobileInputMode) тоже сразу обновилось.
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

  // Звуки победы / поражения — с задержкой 500 мс
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
    // Ключ действия = тип+автор+ход. Меняется при каждом новом «событии хода».
    const actionKey = lastAction
      ? `${turnKey}:${lastAction.type}:${lastAction.actorColor}`
      : null;
    const actionChanged = actionKey !== previousActionKeyRef.current;

    // Взрыв: жизни упали + последнее действие — mine_exploded.
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

    // Захват клетки без мины
    const capturedCount = turn.capturedThisTurn.length;
    const previousCaptured = previousCapturedCountRef.current;
    const newCellsCaptured =
      !turnChanged &&
      previousCaptured !== null &&
      capturedCount > previousCaptured &&
      (phase === 'phase2' || phase === 'phase3');

    // Разминирование (используется счётчик defusesUsedThisTurn)
    const defusesUsed = turn.defusesUsedThisTurn;
    const previousDefusesUsed = previousDefusesUsedRef.current;
    const newDefuse =
      !turnChanged &&
      previousDefusesUsed !== null &&
      defusesUsed > previousDefusesUsed;

    // Установка мины в фазе 3 проигрывается прямо в обработчике клика
    // (последняя мина завершает ход и сбрасывает minesPlacedThisTurn —
    // эффект бы её не «увидел»). Поэтому здесь только обновляем счётчик.
    const minesPlaced = turn.minesPlacedThisTurn;

    // Один звук за обновление состояния — приоритет от самого «громкого» события
    if (hasExplosion) {
      play('explosion');
    } else if (newDefuse) {
      play('disarm');
    } else if (newCellsCaptured) {
      play('locked_cell');
    }

    previousLivesRef.current = currentLives;
    previousCapturedCountRef.current = capturedCount;
    previousActionKeyRef.current = actionKey;
    previousTurnKeyRef.current = turnKey;
    previousDefusesUsedRef.current = defusesUsed;
    previousMinesPlacedRef.current = minesPlaced;
  }, [gameState, play]);

  const renderHeader = (content?: React.ReactNode) => (
    <div className={styles.gameHeader}>
      <h2 className={styles.logo}><Icon name="headquarters" size="2em" /> Minesweeper PvP</h2>
      {content}
      <div className={styles.headerActions}>
        <div className={styles.settingsAnchor} data-settings-anchor>
          <button
            className={`${styles.headerBtn} ${showSettings ? styles.headerBtnActive : ''}`}
            onClick={() => {
              playButton();
              setShowSettings((v) => !v);
            }}
            aria-expanded={showSettings}
            aria-haspopup="menu"
          >
            ⚙️<span className={styles.headerBtnLabel}> Настройки</span>
          </button>
          {showSettings && (
            <SettingsMenu
              muted={muted}
              volume={volume}
              hideControls={hideControls}
              onToggleMuted={() => {
                toggleMuted();
              }}
              onVolumeChange={(v) => setVolume(v)}
              onToggleHideControls={() => {
                playButton();
                toggleHideControls();
              }}
              onClose={() => setShowSettings(false)}
            />
          )}
        </div>
        <button
          className={styles.headerBtn}
          onClick={() => {
            playButton();
            setShowHelp(true);
          }}
        >
          ❓<span className={styles.headerBtnLabel}> Правила</span>
        </button>
      </div>
    </div>
  );

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

  const renderShell = (content: React.ReactNode, headerContent?: React.ReactNode) => (
    <div className={styles.gameLayout}>
      {renderHeader(headerContent)}
      {content}
      {renderErrorToast()}
      {renderOfflineBanner()}
      {showHelp && <HelpModal onClose={closeHelp} />}
    </div>
  );

  if (screen === 'lobby') {
    return renderShell(
      <div className={styles.screenBody}>
        <Lobby
          onCreateRoom={(name, timeControl) => {
            playButton();
            createRoom(name, timeControl);
          }}
          onJoinRoom={(id, name) => {
            playButton();
            joinRoom(id, name);
          }}
          onUiClick={playButton}
        />
      </div>
    );
  }

  if (screen === 'waiting') {
    const copyRoomId = async (e?: React.MouseEvent<HTMLButtonElement>) => {
      // На тач-устройстве снимаем фокус с кнопки, чтобы :focus-visible
      // не оставлял overlay «Скопировано» включённым после возврата надписи.
      e?.currentTarget?.blur();
      if (!roomId) return;
      try {
        await navigator.clipboard.writeText(roomId);
      } catch {
        // Фолбэк для не-HTTPS / старых браузеров — выделяем текст временного <textarea>.
        const ta = document.createElement('textarea');
        ta.value = roomId;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch { /* без копии */ }
        document.body.removeChild(ta);
      }
      playButton();
      setRoomIdCopied(true);
      // На мобиле «Скопировано» должно успеть быть прочитанным, потом снова код.
      window.setTimeout(() => setRoomIdCopied(false), 700);
    };

    return renderShell(
      <div className={styles.centered}>
        <div className={styles.waitCard}>
          <h2>⏳ Ожидание противника...</h2>
          <p>
            ID комнаты:{' '}
            <button
              type="button"
              className={`${styles.roomIdCopy} ${roomIdCopied ? styles.roomIdCopied : ''}`}
              onClick={(e) => copyRoomId(e)}
              title={roomIdCopied ? 'Скопировано!' : 'Нажмите, чтобы скопировать'}
              aria-label="Скопировать ID комнаты"
            >
              <span className={styles.roomId}>{roomId}</span>
              <span className={styles.roomIdOverlay} aria-hidden="true">
                {roomIdCopied ? 'Скопировано!' : 'Скопировать'}
              </span>
            </button>
          </p>
          <p>Поделитесь ID с другом!</p>
          <p className={styles.copyHintMobile}>👆 Нажмите на код, чтобы скопировать</p>
          <button
            type="button"
            className={styles.waitLeaveBtn}
            onClick={() => {
              playButton();
              leaveRoom();
            }}
          >
            ← Выйти в меню
          </button>
        </div>
      </div>
    );
  }

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

    // По умолчанию — неактивная «заглушка»: кнопка остаётся на месте, чтобы
    // соседние блоки (баннер, статистика) не дрыгались вверх-вниз каждый раз,
    // когда у игрока появляется / пропадает действие. Конкретные ветки ниже
    // переопределяют её для случаев, когда действие есть.
    let primaryAction: PrimaryAction = {
      label: isMyTurn ? 'Нет действия' : 'Ход противника',
      onClick: () => {},
      disabled: true,
      variant: 'disabledHint',
    };
    if (isFinished) {
      primaryAction = {
        label: '← Вернуться в меню',
        onClick: () => {
          playButton();
          returnToMenu();
        },
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
        // Пока не расставлены все мины — кнопка должна выглядеть «серой/неактивной»,
        // а не как зелёная/боевая. Используем отдельный вариант.
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

    // Кнопка действия. На десктопе живёт в левой колонке, на мобиле — между
    // баннером синего и блоком фаз/статистики. Чтобы не дублировать разметку,
    // выносим её в локальный хелпер.
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
        <span className={styles.roomBadge}>Комната: {roomId}</span>

        {/* «Разрыв строки» в flex-шапке: невидимый элемент с flex-basis:100%
            на мобиле принудительно переносит всё, что после него, на вторую
            строку. На десктопе display: none и не влияет на раскладку. */}
        <span className={styles.headerRowBreak} aria-hidden="true" />

        {/* Имена игроков. На десктопе остаются в той же строке, что и логотип/
            кнопки. На мобиле уезжают на вторую строку (после разрыва) и
            делят её с кнопками «Настройки/Правила». */}
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
            {opponent?.color === 'red' ? '🔴' : '🔵'} {opponent?.name ?? '...'}
          </span>
        </div>
      </>
    );

    const leftColumnStyle = boardHeight ? { height: boardHeight } : undefined;

    const boardWrapperRefSetter = (el: HTMLDivElement | null) => {
      // Сохраняем наблюдателя, чтобы один и тот же узел не подписывался дважды.
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
        {/* Десктопная левая колонка (controls + кнопка действия).
            На мобиле скрывается через CSS (display: none), а её роль
            выполняют отдельные элементы ниже — баннеры, мобильная кнопка,
            и mobileControls. */}
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
          />
          <div className={styles.actionButtonSlot}>
            {renderPrimaryActionButton()}
          </div>
        </div>

        {/* Мобильный баннер красного игрока — над доской. */}
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
          onWrapperRef={boardWrapperRefSetter}
          onSelectZone={(row, col) => {
            play('scan');
            selectZone(row, col);
          }}
          onCaptureCell={(row, col) => {
            // Звук появится из эффекта по обновлению gameState
            // (locked_cell или explosion — в зависимости от результата)
            captureCell(row, col);
          }}
          onDefuseCell={(row, col) => {
            // Звук disarm появится из эффекта при росте defusesUsedThisTurn
            defuseCell(row, col);
          }}
          onPlaceMinePhase3={(row, col) => {
            // Играем сразу: последняя мина завершает ход, и счётчик
            // minesPlacedThisTurn сбрасывается до следующего рендера —
            // эффект по состоянию его «не увидит».
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
            // Звук появится из эффекта по обновлению gameState
            // (locked_cell — захват, explosion — взрыв при ошибке).
            chord(row, col);
          }}
          onLocalError={(message) => {
            showLocalError(message);
          }}
        />
        </div>

        {/* Мобильный баннер синего игрока — под доской. */}
        <div className={`${styles.mobileBanner} ${styles.mobileBannerBlue} ${styles.mobileOnly}`}>
          <GameInfo
            gameState={gameState}
            myColor={myColor}
            section="banner"
            bannerColor="blue"
            gameOver={gameOver}
          />
        </div>

        {/* Мобильная кнопка действия + переключатели режима тапа.

           Доступность кнопок:
             • Флаг       — фаза 2 (свой или чужой ход). В конце игры — нет.
             • Разминировать — фаза 2 И мой ход (иначе действие невозможно).
           Если режим становится недоступным — сразу гасим его (см. эффект ниже). */}
        {(() => {
          const flagEnabled   = !isFinished && turn.phase === 'phase2';
          const defuseEnabled = !isFinished && turn.phase === 'phase2' && isMyTurn;
          return (
        <div className={`${styles.actionButtonSlot} ${styles.mobileActionSlot} ${styles.mobileOnly}`}>
          <div className={styles.mobileModeRow}>
            <button
              type="button"
              className={`${styles.mobileModeBtn} ${mobileInputMode === 'flag' ? styles.mobileModeBtnActive : ''}`}
              onClick={() => {
                playButton();
                setMobileInputMode((m) => (m === 'flag' ? 'normal' : 'flag'));
              }}
              aria-pressed={mobileInputMode === 'flag'}
              disabled={!flagEnabled}
              title="Режим флажков / вопросов (как ПКМ)"
            >
              🚩 Флаг
            </button>
            <button
              type="button"
              className={`${styles.mobileModeBtn} ${mobileInputMode === 'defuse' ? styles.mobileModeBtnActive : ''}`}
              onClick={() => {
                playButton();
                setMobileInputMode((m) => (m === 'defuse' ? 'normal' : 'defuse'));
              }}
              aria-pressed={mobileInputMode === 'defuse'}
              disabled={!defuseEnabled}
              title="Режим разминирования (как Ctrl+ЛКМ)"
            >
              🔧 Разминировать
            </button>
          </div>
          {renderPrimaryActionButton()}
        </div>
          );
        })()}

        {/* Мобильный блок controls (фаза, lastAction). На десктопе он живёт
            внутри .sideColumnLeft. */}
        <div className={`${styles.sideColumn} ${styles.mobileControls} ${styles.mobileOnly}`}>
          <GameInfo
            gameState={gameState}
            myColor={myColor}
            section="controls"
            gameOver={gameOver}
            hideControls={hideControls}
          />
        </div>

        <div className={styles.sideColumn}>
          <GameInfo
            gameState={gameState}
            myColor={myColor}
            section="stats"
            hideControls={hideControls}
          />
        </div>
      </div>,
      headerContent
    );
  }

  return null;
}
