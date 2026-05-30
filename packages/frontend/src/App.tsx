import React, { useEffect, useRef, useState } from 'react';
import { useSocket } from './hooks/useSocket';
import { useSound } from './hooks/useSound';
import { useSettings } from './hooks/useSettings';
import { Lobby }     from './components/Lobby/Lobby';
import { Board }     from './components/Board/Board';
import { GameInfo }  from './components/GameInfo/GameInfo';
import { HelpModal } from './components/HelpModal/HelpModal';
import { SettingsMenu } from './components/SettingsMenu/SettingsMenu';
import styles from './App.module.css';

export default function App() {
  const {
    screen, roomId, myColor, myName, gameState, errorMsg, gameOver,
    createRoom, joinRoom,
    placeMineSetup, confirmSetup,
    selectZone, captureCell, defuseCell, endPhase2, endPhase3, placeMinePhase3, toggleMark,
    returnToMenu,
  } = useSocket();

  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [boardHeight, setBoardHeight] = useState<number | null>(null);

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
  const previousActionMessageRef = useRef<string | null>(null);
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
    const message = turn.lastActionMessage;
    const messageChanged = message !== previousActionMessageRef.current;

    // Взрыв: жизни упали + сообщение начинается с 💥
    const livesDecreased = previousLives
      ? gameState.players.some(
        (player) => player.lives < (previousLives[player.color] ?? player.lives)
      )
      : false;
    const isExplosionMessage = !!message && message.startsWith('💥');
    const hasExplosion =
      livesDecreased &&
      isExplosionMessage &&
      messageChanged &&
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
    previousActionMessageRef.current = message;
    previousTurnKeyRef.current = turnKey;
    previousDefusesUsedRef.current = defusesUsed;
    previousMinesPlacedRef.current = minesPlaced;
  }, [gameState, play]);

  const renderHeader = (content?: React.ReactNode) => (
    <div className={styles.gameHeader}>
      <h2 className={styles.logo}>💣 Minesweeper PvP</h2>
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
            ⚙️ Настройки
          </button>
          {showSettings && (
            <SettingsMenu
              muted={muted}
              volume={volume}
              hideControls={hideControls}
              onToggleMuted={() => {
                playButton();
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
          ❓ Правила
        </button>
      </div>
    </div>
  );

  const renderErrorToast = () => (
    errorMsg ? <div className={styles.toastError}>{errorMsg}</div> : null
  );

  const renderShell = (content: React.ReactNode, headerContent?: React.ReactNode) => (
    <div className={styles.gameLayout}>
      {renderHeader(headerContent)}
      {content}
      {renderErrorToast()}
      {showHelp && <HelpModal onClose={closeHelp} />}
    </div>
  );

  if (screen === 'lobby') {
    return renderShell(
      <div className={styles.screenBody}>
        <Lobby
          onCreateRoom={(name) => {
            playButton();
            createRoom(name);
          }}
          onJoinRoom={(id, name) => {
            playButton();
            joinRoom(id, name);
          }}
        />
      </div>
    );
  }

  if (screen === 'waiting') {
    return renderShell(
      <div className={styles.centered}>
        <div className={styles.waitCard}>
          <h2>⏳ Ожидание противника...</h2>
          <p>ID комнаты: <strong className={styles.roomId}>{roomId}</strong></p>
          <p>Поделитесь ID с другом!</p>
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
      variant?: 'menu';
      disabled?: boolean;
    } | null;

    let primaryAction: PrimaryAction = null;
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
      const remaining = gameState.config.initialMines - me.minesPlaced;
      const canConfirm = remaining === 0;
      primaryAction = {
        label: canConfirm
          ? 'Подтвердить ✓'
          : `Поставьте ещё ${remaining} 💣 `,
        onClick: () => {
          if (!canConfirm) return;
          playButton();
          confirmSetup();
        },
        disabled: !canConfirm,
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
        label: 'Завершить расстановку →',
        onClick: () => {
          playButton();
          endPhase3();
        },
      };
    }

    primaryActionRef.current =
      primaryAction && !primaryAction.disabled ? primaryAction.onClick : null;

    const headerContent = (
      <>
        <span className={styles.roomBadge}>Комната: {roomId}</span>

        {/* Имя текущего игрока */}
        <span
          className={styles.playerBadge}
          style={{ borderColor: myColor === 'red' ? '#e74c3c' : '#3498db' }}
        >
          {myColor === 'red' ? '🔴' : '🔵'} {me?.name ?? myName}
        </span>

        <span className={styles.vs}>vs</span>

        {/* Имя противника */}
        <span
          className={styles.playerBadge}
          style={{ borderColor: opponent?.color === 'red' ? '#e74c3c55' : '#3498db55' }}
        >
          {opponent?.color === 'red' ? '🔴' : '🔵'} {opponent?.name ?? '...'}
        </span>
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
        <div
          className={`${styles.sideColumn} ${styles.sideColumnLeft}`}
          style={leftColumnStyle}
        >
          <GameInfo
            gameState={gameState}
            myColor={myColor}
            section="controls"
            gameOver={gameOver}
          />
          <div className={styles.actionButtonSlot}>
            {primaryAction && (
              <button
                className={`${styles.primaryActionBtn} ${
                  primaryAction.variant === 'menu' ? styles.menuVariant : ''
                }`}
                onClick={primaryAction.onClick}
                disabled={!!primaryAction.disabled}
              >
                {primaryAction.label}
              </button>
            )}
          </div>
        </div>
        <Board
          gameState={gameState}
          myColor={myColor}
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
        />
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
