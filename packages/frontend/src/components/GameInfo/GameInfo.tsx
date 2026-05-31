import React, { useEffect, useRef, useState } from 'react';
import {
  S2C_GameState,
  S2C_GameOver,
  PlayerColor,
  PlayerState,
  TurnState,
  BALANCE,
} from '@minesweeper-pvp/shared';
import { Icon } from '../Icon/Icon';
import styles from './GameInfo.module.css';

// Единый тип для информации об окончании игры — определён в shared.
export type GameOverInfo = S2C_GameOver;

interface GameInfoProps {
  gameState: S2C_GameState;
  myColor: PlayerColor;
  section?: 'controls' | 'stats';
  gameOver?: GameOverInfo | null;
  /** Скрыть подсказки: блок «Управление» (section='stats') и блок текущей фазы (section='controls'). */
  hideControls?: boolean;
}

const PHASE_LABELS: Record<string, string> = {
  phase1: 'Фаза 1 — Разведка',
  phase2: 'Фаза 2 — Захват',
  phase3: 'Фаза 3 — Минирование',
};

const PHASE_DESCRIPTIONS: Record<string, string> = {
  phase1: 'Выберите центр зоны 3×3 — увидите цифры подсказок.',
  phase2: 'Захватывайте клетки противника в зоне 5×5.',
  phase3: 'Поставьте мины на свою территорию и завершите ход.',
};

/**
 * Сообщение «что только что произошло» для конкретного зрителя.
 * Берём структурное `lastAction` с бэка и собираем текст от первого лица.
 */
function describeLastAction(
  action: import('@minesweeper-pvp/shared').LastAction,
  myColor: PlayerColor,
): { text: string; tone: 'danger' | 'warning' | 'success' } {
  const mine = action.actorColor === myColor;
  switch (action.type) {
    case 'mine_exploded':
      return mine
        ? { text: '💥 Вы наступили на мину! Потеряна жизнь.',         tone: 'danger'  }
        : { text: '💥 Противник наступил на мину и потерял жизнь.',    tone: 'danger'  };
    case 'defuse_success':
      return mine
        ? { text: '✅ Разминирование успешно! Клетка захвачена. Ход продолжается.', tone: 'success' }
        : { text: '✅ Противник успешно разминировал клетку и захватил её.',         tone: 'success' };
    case 'defuse_no_mine':
      return mine
        ? { text: '⚠️ Мины не оказалось. Клетка захвачена. Ход переходит к фазе 3.', tone: 'warning' }
        : { text: '⚠️ Противник попытался разминировать пустую клетку и захватил её.', tone: 'warning' };
  }
}

const DEFUSE_GRANT_INTERVAL = BALANCE.defuse.grantInterval;

function pluralize(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Вычисляет оставшееся время игрока с учётом смещения локальных часов
 * относительно сервера.
 *
 * Если игрок сейчас ходит и часы запущены — вычитаем прошедшее с начала хода.
 */
function computeRemainingMs(
  player: PlayerState,
  turn: Pick<TurnState, 'currentPlayer' | 'currentTurnStartedAtMs'>,
  serverClientOffsetMs: number,
): number {
  if (
    player.color !== turn.currentPlayer ||
    turn.currentTurnStartedAtMs === null
  ) {
    return player.timeMs;
  }
  const serverNow = Date.now() + serverClientOffsetMs;
  const elapsed = Math.max(0, serverNow - turn.currentTurnStartedAtMs);
  return Math.max(0, player.timeMs - elapsed);
}

export function GameInfo({
  gameState,
  myColor,
  section = 'controls',
  gameOver,
  hideControls = false,
}: GameInfoProps) {
  const { players, turn, config, stats } = gameState;
  const isMyTurn = turn.currentPlayer === myColor;

  const redPlayer  = players.find((p) => p.color === 'red')!;
  const bluePlayer = players.find((p) => p.color === 'blue')!;

  // Флажки — из доски
  const flagCount = gameState.board.flat().filter((c) => c.mark === 'flag').length;

  const turnsUntilNextDefuse =
    DEFUSE_GRANT_INTERVAL - (turn.turnsPlayed % DEFUSE_GRANT_INTERVAL);
  const defusesLeftThisTurn = Math.max(0, turn.defusesPerTurn - turn.defusesUsedThisTurn);
  const minesBonus = Math.max(0, turn.minesAllowedThisTurn - config.minesPerTurn);

  // ─── Шахматные часы: локальный тик ──────────────────────────────────────────
  // Смещение между серверным и клиентским временем фиксируем при каждом
  // обновлении gameState: offset = serverNow - clientNow.
  const serverClientOffsetRef = useRef(0);
  useEffect(() => {
    serverClientOffsetRef.current = turn.serverNowMs - Date.now();
  }, [turn.serverNowMs]);

  // Используем "tick" чтобы перерисовывать компонент каждые 250мс
  // во время хода (только для отображения секундомера).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (turn.currentTurnStartedAtMs === null) return;
    const id = setInterval(() => setTick((t) => (t + 1) % 1_000_000), 250);
    return () => clearInterval(id);
  }, [turn.currentTurnStartedAtMs]);

  const redRemaining  = computeRemainingMs(redPlayer,  turn, serverClientOffsetRef.current);
  const blueRemaining = computeRemainingMs(bluePlayer, turn, serverClientOffsetRef.current);

  const renderHearts = (lives: number, max: number) =>
    Array.from({ length: max }, (_, i) => (
      <span key={i} className={i < lives ? styles.heartFull : styles.heartEmpty}>
        {i < lives ? '❤️' : '🖤'}
      </span>
    ));

  if (section === 'stats') {
    return (
      <div className={styles.panel}>
        <div className={styles.statsBlock}>
          <div className={styles.statsTitle}>📊 Статистика</div>

          <div className={styles.statHeader}>Раунды</div>
          <div className={styles.statRow}>
            <span>🔁 Сыграно ходов:</span>
            <strong>{turn.turnsPlayed}</strong>
          </div>

          <div className={styles.statHeader}>Разминирований на ход</div>
          <div className={styles.statRow}>
            <span>🔧 Лимит:</span>
            <strong>{turn.defusesPerTurn}</strong>
          </div>
          <div className={styles.statRow}>
            <span>⏭️ +1 через:</span>
            <strong>
              {turnsUntilNextDefuse} {pluralize(turnsUntilNextDefuse, ['ход', 'хода', 'ходов'])}
            </strong>
          </div>

          <div className={styles.statHeader}>Контроль времени</div>
          <div className={styles.statRow}>
            <span>⏱️ База + инкремент:</span>
            <strong>
              {Math.round(config.timeControl.baseMs / 60_000)} + {Math.round(config.timeControl.incrementMs / 1000)}
            </strong>
          </div>

          <div className={styles.statHeader}>Мины на поле</div>
          <div className={styles.statRow}>
            <span className={styles.redLabel}>🔴 Красный:</span>
            <strong className={styles.redVal}>{stats.redMines}</strong>
          </div>
          <div className={styles.statRow}>
            <span className={styles.blueLabel}>🔵 Синий:</span>
            <strong className={styles.blueVal}>{stats.blueMines}</strong>
          </div>

          <div className={styles.statHeader}>Клеток во владении</div>
          <div className={styles.statRow}>
            <span className={styles.redLabel}>🔴 Красный:</span>
            <strong className={styles.redVal}>{stats.redCells}</strong>
          </div>
          <div className={styles.statRow}>
            <span className={styles.blueLabel}>🔵 Синий:</span>
            <strong className={styles.blueVal}>{stats.blueCells}</strong>
          </div>

          <div className={styles.statDivider} />
          <div className={styles.statRow}>
            <span>🚩 Флажков:</span>
            <strong>{flagCount}</strong>
          </div>

          {turn.phase === 'phase3' && isMyTurn && (
            <div className={`${styles.statRow} ${styles.phase3Row}`}>
              <span>📍 Поставлено мин:</span>
              <strong>{turn.minesPlacedThisTurn} / {turn.minesAllowedThisTurn}</strong>
            </div>
          )}
          {turn.phase === 'phase3' && isMyTurn && minesBonus > 0 && (
            <div className={`${styles.statRow} ${styles.phase3Row}`}>
              <span><Icon name="headquarters" /> Бонус за штаб:</span>
              <strong>+{minesBonus}</strong>
            </div>
          )}
        </div>

        {/* Управление (по стилю как statsBlock) — можно скрыть через настройки */}
        {!hideControls && (
          <div className={styles.controlsBlock}>
            <div className={styles.controlsTitle}>🎮 Управление</div>
            <div className={styles.controlsRow}>🖱️ ЛКМ — действие</div>
            <div className={styles.controlsRow}>🖱️ ПКМ — флаг / ? / убрать</div>
            <div className={styles.controlsRow}>⌨️ Ctrl+Click — разминировать</div>
            <div className={styles.controlsRow}><Icon name="headquarters" /> Захват штаба — мгновенная победа</div>
            <div className={styles.controlsRow}>
              <span className={styles.hotkeyKey}>Space</span> — кнопка слева от доски
            </div>
            <div className={styles.controlsDivider} />
            <div className={styles.controlsTitle}>📋 Фазы хода</div>
            <div className={styles.controlsRow}>1️⃣ Выбор зоны 3×3</div>
            <div className={styles.controlsRow}>2️⃣ Захват по границе (зона 5×5)</div>
            <div className={styles.controlsRow}>3️⃣ Поставить 0–3 мины (+1 за штаб в зоне 5×5)</div>
          </div>
        )}
      </div>
    );
  }

  const isFinished = turn.phase === 'finished' || !!gameState.winnerColor;
  const isSetup = turn.phase === 'setup';
  const winnerColor = gameOver?.winnerColor ?? gameState.winnerColor ?? null;
  const iWon = winnerColor !== null && winnerColor === myColor;
  const reason = gameOver?.reason;

  const me = players.find((p) => p.color === myColor);
  const opponent = players.find((p) => p.color !== myColor);
  const iConfirmed = me?.setupConfirmed ?? false;
  const opponentConfirmed = opponent?.setupConfirmed ?? false;

  // Часы тикают только когда они "запущены" (currentTurnStartedAtMs !== null)
  // т.е. вне фазы setup и finished.
  const clockActive = turn.currentTurnStartedAtMs !== null && !isFinished;
  const isLowTime = (ms: number) => ms < 30_000;

  return (
    <div className={styles.panel}>
      {/* Статус хода / Победитель / Подготовка */}
      {isFinished && winnerColor ? (
        <div className={iWon ? styles.winnerBanner : styles.loserBanner}>
          <div className={styles.bannerHead}>
            <span className={styles.turnIcon}>{iWon ? '🏆' : '💀'}</span>
            <span>{iWon ? 'Победа!' : 'Поражение'}</span>
          </div>
        </div>
      ) : isSetup ? (
        <div className={`${styles.turnStatus} ${iConfirmed ? styles.opponentTurn : styles.myTurn}`}>
          <span className={styles.turnIcon}>
            {iConfirmed ? '⏳' : <Icon name="mine" size="1.1em" />}
          </span>
          <span>{iConfirmed ? 'Ожидание противника...' : 'Расставьте мины'}</span>
        </div>
      ) : (
        <div className={`${styles.turnStatus} ${isMyTurn ? styles.myTurn : styles.opponentTurn}`}>
          <span className={styles.turnIcon}>{isMyTurn ? '⚔️' : '⏳'}</span>
          <span>{isMyTurn ? 'Ваш ход!' : 'Ход противника...'}</span>
        </div>
      )}

      {/* Карточки игроков.
          - В фазе setup активной считается КАРТОЧКА ИГРОКА-ЗРИТЕЛЯ
            (чтобы каждый видел «свой» цвет подсвеченным).
          - В finished — карточка победителя; вместо «ходит» — 🏆.
          - В остальных фазах — карточка чей сейчас ход. */}
      {(['red', 'blue'] as const).map((color) => {
        const player = color === 'red' ? redPlayer : bluePlayer;
        const remaining = color === 'red' ? redRemaining : blueRemaining;
        const isHighlighted = isSetup
          ? color === myColor
          : isFinished
            ? color === winnerColor
            : turn.currentPlayer === color;
        const isWinnerCard = isFinished && color === winnerColor;
        return (
          <div
            key={color}
            className={[
              styles.playerCard,
              color === 'red' ? styles.red : styles.blue,
              isHighlighted ? styles.activePlayer : styles.inactivePlayer,
            ].join(' ')}
          >
            <div className={styles.playerHeader}>
              <span className={styles.playerLabel}>
                {color === 'red' ? '🔴 Красный' : '🔵 Синий'}
              </span>
              {isWinnerCard
                ? <span className={styles.activeBadge}>🏆 победа</span>
                : (!isFinished && !isSetup && turn.currentPlayer === color)
                  ? <span className={styles.activeBadge}>ходит</span>
                  : null}
            </div>
            <div className={[
              styles.playerClock,
              clockActive && turn.currentPlayer === color ? styles.playerClockRunning : '',
              isLowTime(remaining) ? styles.playerClockLow : '',
            ].join(' ')}>
              ⏱ {formatTime(remaining)}
            </div>
            <div className={styles.hearts}>{renderHearts(player.lives, config.maxLives)}</div>
          </div>
        );
      })}

      {/* Текущая фаза (только во время игры) — краткое название + цель.
          Скрывается настройкой «Скрыть подсказки». */}
      {!isFinished && !isSetup && !hideControls && (
        <div className={styles.phaseBox}>
          <div className={styles.phaseTitle}>{PHASE_LABELS[turn.phase] ?? turn.phase}</div>
          <div className={styles.phaseDesc}>{PHASE_DESCRIPTIONS[turn.phase]}</div>
        </div>
      )}

      {/* Подготовка — статус расстановки мин */}
      {isSetup && !hideControls && (
        <div className={styles.phaseBox}>
          <div className={styles.phaseTitle}>Подготовка</div>
          <div className={styles.phaseDesc}>
            {iConfirmed
              ? opponentConfirmed
                ? 'Оба готовы, начинаем...'
                : `Ожидание: ${opponent?.name ?? 'противник'} расставляет мины.`
              : <>Расставьте мины на своей половине. <Icon name="headquarters" /> — штаб (нельзя заминировать).</>}
          </div>
        </div>
      )}

      {/* Причина окончания */}
      {isFinished && reason && (
        <div className={styles.phaseBox}>
          <div className={styles.phaseTitle}>Игра окончена</div>
          <div className={styles.phaseDesc}>
            {reason === 'lives' && 'Потеряны все жизни'}
            {reason === 'headquarters' && 'Захвачен штаб'}
            {reason === 'time' && 'Истекло время на партию'}
          </div>
        </div>
      )}

      {/* Сообщение «что только что произошло» — от первого лица для зрителя. */}
      {turn.lastAction && (() => {
        const { text, tone } = describeLastAction(turn.lastAction, myColor);
        const toneClass = tone === 'danger'  ? styles.messageDanger
                        : tone === 'warning' ? styles.messageWarning
                                             : styles.messageSuccess;
        return (
          <div className={`${styles.actionMessage} ${toneClass}`}>{text}</div>
        );
      })()}
    </div>
  );
}
