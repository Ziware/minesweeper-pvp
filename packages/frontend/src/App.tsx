import React, { useEffect, useRef, useState } from 'react';
import type { PlayerColor } from '@minesweeper-pvp/shared';
import { useSocket } from './hooks/useSocket';
import { useSound } from './hooks/useSound';
import { useSettings } from './hooks/useSettings';
import { useLocalGame } from './ai/driver/useLocalGame';
import type { Difficulty } from './ai/types';
import { Lobby }     from './components/Lobby/Lobby';
import { Board, MobileInputMode } from './components/Board/Board';
import { GameInfo, SideNotice, describeLastAction }  from './components/GameInfo/GameInfo';
import { HelpModal } from './components/HelpModal/HelpModal';
import { SettingsMenu } from './components/SettingsMenu/SettingsMenu';
import { Icon } from './components/Icon/Icon';
import { useAuth } from './hooks/useAuth';
import { ProfileButton } from './components/ProfileButton/ProfileButton';
import styles from './App.module.css';

type GameMode = 'pvp' | 'solo';

export default function App() {
  // Solo-mode parameters set from the Lobby. `soloEnabled` flips on when the
  // user clicks "Start" on the vs-Computer card; it's cleared on returnToMenu.
  const [gameMode, setGameMode] = useState<GameMode>('pvp');
  const [soloEnabled, setSoloEnabled] = useState(false);
  const [soloHumanColor, setSoloHumanColor] = useState<PlayerColor>('red');
  const [soloDifficulty, setSoloDifficulty] = useState<Difficulty>('normal');
  const [soloHumanName, setSoloHumanName] = useState('');
  const [soloNonce, setSoloNonce] = useState(0);
  // sessionId стабилен на одну партию vs. бот — бэкенд использует его, чтобы
  // склеивать события одного матча в один JSONL-файл.
  const soloSessionIdRef = useRef<string>('');

  const auth = useAuth();
  const pvpSession = useSocket();
  const logSoloEvent = pvpSession.logSoloEvent;
  const soloSession = useLocalGame({
    enabled: soloEnabled,
    humanColor: soloHumanColor,
    humanName: soloHumanName || 'Игрок',
    difficulty: soloDifficulty,
    gameNonce: soloNonce,
    onSession: (kind, meta) => {
      const sid = soloSessionIdRef.current;
      if (!sid) return;
      if (kind === 'session_start') {
        logSoloEvent({
          kind: 'session_start',
          sessionId: sid,
          playerName: meta.humanName,
          humanColor: meta.humanColor,
          difficulty: meta.difficulty,
          config: meta.config,
        });
      }
      // 'session_finished' специально не отправляем — recorder закроется по
      // приходу game_finished (это уже сделано в onSoloEvent).
    },
    onSoloEvent: (event) => {
      const sid = soloSessionIdRef.current;
      if (!sid) return;
      logSoloEvent({ ...event, sessionId: sid } as any);
    },
    onLogAux: (auxKind, details) => {
      const sid = soloSessionIdRef.current;
      if (!sid) return;
      logSoloEvent({ kind: 'session_aux', sessionId: sid, auxKind, details });
    },
  });

  const session = gameMode === 'solo' ? soloSession : pvpSession;
  const {
    screen, roomId, myColor, myName, gameState, errorMsg, gameOver, serverReachable,
    createRoom, joinRoom,
    placeMineSetup, confirmSetup,
    selectZone, captureCell, defuseCell, chord, endPhase2, endPhase3, placeMinePhase3, toggleMark,
    showLocalError,
    returnToMenu: sessionReturnToMenu, leaveRoom: sessionLeaveRoom,
  } = session;

  const returnToMenu = () => {
    sessionReturnToMenu();
    setSoloEnabled(false);
    setGameMode('pvp');
  };
  const leaveRoom = () => {
    sessionLeaveRoom();
    setSoloEnabled(false);
    setGameMode('pvp');
  };

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
    toggleFlagClickDefuse,
  } = useSettings();
  const { muted, hideControls, volume, flagClickDefuse } = settings;

  const { play, playDelayed, preload } = useSound({ mutedRef, volumeRef });

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

  // Единая «бегущая» нотификация слева. Любое игровое событие — взрыв,
  // успешный/пустой дефьюз, выдача +N разминирований обоим, бонус +1 мина
  // за зону над штабом — кладёт сюда новый объект, перетирая предыдущий.
  // Параллельно запускается таймер на 5с, по истечении которого слот
  // обнуляется. Если до таймаута приходит новое уведомление — старый таймер
  // сбрасывается, и обратный отсчёт начинается заново для нового события.
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

  // Флаги «у кого из игроков таймер уже ушёл в low-time зону». Нужны, чтобы
  // звук low_timer проигрывался только в момент пересечения порога, а не
  // повторялся каждый tick. Сбрасываются при смене партии.
  const lowTimeFiredRef = useRef<Record<'red' | 'blue', boolean>>({
    red: false,
    blue: false,
  });

  const playButton = () => play('button');
  const closeHelp = () => {
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

    // Единая «бегущая» нотификация — слева. Новые события перетирают старые,
    // плюс таймаут на 5с (см. pushSideNotice). Порядок проверок повторяет
    // приоритет звуков выше (взрыв > дефьюз > что-либо ещё).

    // 1) Взрыв/успешный/пустой дефьюз — берём готовый текст из describeLastAction.
    if (actionChanged && lastAction && myColor) {
      const { text, tone } = describeLastAction(lastAction, myColor);
      pushSideNotice(text, tone);
    }

    // 2) Прибавка лимита разминирований обоим игрокам: defusesPerTurn вырос
    //    относительно предыдущего gameState. Звук — с задержкой 300 мс, чтобы
    //    не слиться со звуком клика кнопки «Завершить ход». Уведомление —
    //    зелёное, как успешный дефьюз. Перетирает уведомление из п.1, что
    //    логично: грант пришёл «поверх» только что отыгранного действия.
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

    // 3) Бонус +N мин за зону над штабом (только для текущего игрока, и
    //    только в фазе 3 у того, чей ход). Триггерим один раз при входе
    //    в фазу 3 — следим за тем, чтобы не повторять для одного и того же
    //    хода. Если зона не накрыла штаб — minesAllowedThisTurn совпадает
    //    с config.minesPerTurn и уведомления нет.
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

  // Low-time звук: проигрывается ОДИН РАЗ для каждого игрока в тот момент,
  // когда его оставшееся время впервые опускается ниже 30 секунд. Слышат
  // оба игрока (звук общий — это сигнал «у кого-то таймер на исходе»).
  // Таймер обновляется ~раз в 250 мс, чтобы порог не «терялся» между
  // gameState-апдейтами.
  useEffect(() => {
    if (!gameState) return;
    const turn = gameState.turn;
    if (turn.phase === 'finished' || gameState.winnerColor) return;
    if (turn.currentTurnStartedAtMs === null) return; // часы не идут (setup)

    const LOW_TIME_MS = 60_000;

    // Сбрасываем флаги, если игрок «отрос» обратно (например, инкремент
    // за завершённый ход вернул timeMs выше порога) — чтобы следующее
    // пересечение порога снова прозвучало.
    const checkAndFire = () => {
      const serverNow = Date.now() + (turn.serverNowMs - Date.now()); // = turn.serverNowMs на старте
      // На самом деле смещение хранится в GameInfo; здесь возьмём проще —
      // считаем оставшееся время по локальным часам относительно serverNowMs.
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
          // No-timer mode (solo vs bot): never fire low-time alerts.
          lowTimeFiredRef.current[color] = false;
          continue;
        }
        if (remaining < LOW_TIME_MS) {
          if (!lowTimeFiredRef.current[color]) {
            lowTimeFiredRef.current[color] = true;
            play('low_timer');
          }
        } else {
          // Игрок снова выше порога (инкремент за ход) — разрешаем повторный
          // алерт при следующем пересечении.
          lowTimeFiredRef.current[color] = false;
        }
      }
      // serverNow используется неявно через offset — подавим неиспользованную
      // переменную, чтобы линтер не ругался.
      void serverNow;
    };

    checkAndFire();
    const id = window.setInterval(checkAndFire, 250);
    return () => window.clearInterval(id);
  }, [gameState, play]);

  // При смене партии (новый roomId / возврат в лобби) сбрасываем флаги
  // low-time, иначе при новой игре звук может не сработать.
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

  const renderHeader = (content?: React.ReactNode) => (
    <div className={styles.gameHeader}>
      <h2 className={styles.logo}><Icon name="headquarters" size="2em" /> Minesweeper PvP</h2>
      {content}
      <div className={styles.headerActions}>
        <div className={styles.settingsAnchor} data-settings-anchor>
          <button
            className={`${styles.headerBtn} ${showSettings ? styles.headerBtnActive : ''}`}
            onClick={() => {
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
              flagClickDefuse={flagClickDefuse}
              onToggleMuted={() => {
                toggleMuted();
              }}
              onVolumeChange={(v) => setVolume(v)}
              onToggleHideControls={() => {
                toggleHideControls();
              }}
              onToggleFlagClickDefuse={() => {
                toggleFlagClickDefuse();
              }}
              onClose={() => setShowSettings(false)}
            />
          )}
        </div>
        <button
          className={styles.headerBtn}
          onClick={() => {
            setShowHelp(true);
          }}
        >
          ❓<span className={styles.headerBtnLabel}> Правила</span>
        </button>
        <ProfileButton auth={auth} />
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

  const renderShell = (content: React.ReactNode, headerContent?: React.ReactNode) => (
    <div className={styles.gameLayout}>
      {renderHeader(headerContent)}
      {content}
      {renderErrorToast()}
      {renderMobileNoticeToast()}
      {renderOfflineBanner()}
      {showHelp && <HelpModal onClose={closeHelp} />}
    </div>
  );

  if (screen === 'lobby') {
    return renderShell(
      <div className={styles.screenBody}>
        <Lobby
          onCreateRoom={(name, timeControl) => {
            setGameMode('pvp');
            createRoom(name, timeControl);
          }}
          onJoinRoom={(id, name) => {
            setGameMode('pvp');
            joinRoom(id, name);
          }}
          onStartSolo={(name, difficulty, humanColor) => {
            setSoloHumanName(name);
            setSoloDifficulty(difficulty);
            setSoloHumanColor(humanColor);
            soloSessionIdRef.current = `solo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            setGameMode('solo');
            setSoloEnabled(true);
            setSoloNonce((n) => n + 1);
          }}
          onUiClick={() => {}}
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
            sideNotice={sideNotice}
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
          flagClickDefuse={flagClickDefuse}
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
            sideNotice={sideNotice}
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
