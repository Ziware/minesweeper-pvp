import React from 'react';
import { S2C_GameState, PlayerColor } from '@minesweeper-pvp/shared';
import styles from './GameInfo.module.css';

export interface GameOverInfo {
  winnerColor: PlayerColor;
  reason: 'lives' | 'headquarters' | 'territory';
}

interface GameInfoProps {
  gameState: S2C_GameState;
  myColor: PlayerColor;
  section?: 'controls' | 'stats';
  gameOver?: GameOverInfo | null;
  /** Скрыть блок «Управление» внутри section='stats' */
  hideControls?: boolean;
}

const PHASE_LABELS: Record<string, string> = {
  phase1: 'Фаза 1 — выбор зоны 3×3',
  phase2: 'Фаза 2 — захват клеток',
  phase3: 'Фаза 3 — расстановка мин',
};

const PHASE_DESCRIPTIONS: Record<string, string> = {
  phase1: 'Кликните на поле, чтобы выбрать зону 3×3. В зоне должна быть хотя бы одна ваша доступная клетка, соединённая со штабом.',
  phase2: 'Захватывайте вражеские клетки в зоне 5×5 рядом с доступной клеткой. Ctrl+Click — разминировать.',
  phase3: 'Поставьте от 0 до лимита мин на свои свободные доступные клетки и завершите ход.',
};

const DEFUSE_GRANT_INTERVAL = 5;

function pluralize(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
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

  const totalTurnLimit = config.turnLimitPerPlayer * 2;
  const turnsUntilNextDefuse =
    DEFUSE_GRANT_INTERVAL - (turn.turnsPlayed % DEFUSE_GRANT_INTERVAL);
  const willGetMoreDefuses = turn.turnsPlayed + turnsUntilNextDefuse < totalTurnLimit;
  const defusesLeftThisTurn = Math.max(0, turn.defusesPerTurn - turn.defusesUsedThisTurn);
  const minesBonus = Math.max(0, turn.minesAllowedThisTurn - config.minesPerTurn);

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
            <strong>{turn.turnsPlayed} / {totalTurnLimit}</strong>
          </div>

          <div className={styles.statHeader}>Разминирований на ход</div>
          <div className={styles.statRow}>
            <span>🔧 Лимит:</span>
            <strong>{turn.defusesPerTurn}</strong>
          </div>
          {willGetMoreDefuses && (
            <div className={styles.statRow}>
              <span>⏭️ +1 через:</span>
              <strong>
                {turnsUntilNextDefuse} {pluralize(turnsUntilNextDefuse, ['ход', 'хода', 'ходов'])}
              </strong>
            </div>
          )}

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
              <span>🏛️ Бонус за штаб:</span>
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
            <div className={styles.controlsRow}>🏛️ Захват штаба — мгновенная победа</div>
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
  const minesLeft = Math.max(0, config.initialMines - (me?.minesPlaced ?? 0));

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
          <span className={styles.turnIcon}>{iConfirmed ? '⏳' : '💣'}</span>
          <span>{iConfirmed ? 'Ожидание противника...' : 'Расставьте мины'}</span>
        </div>
      ) : (
        <div className={`${styles.turnStatus} ${isMyTurn ? styles.myTurn : styles.opponentTurn}`}>
          <span className={styles.turnIcon}>{isMyTurn ? '⚔️' : '⏳'}</span>
          <span>{isMyTurn ? 'Ваш ход!' : 'Ход противника...'}</span>
        </div>
      )}

      {/* Карточки игроков */}
      <div className={styles.playersSection}>
        <div className={[
          styles.playerCard, styles.red,
          turn.currentPlayer === 'red' ? styles.activePlayer : styles.inactivePlayer,
        ].join(' ')}>
          <div className={styles.playerHeader}>
            <span className={styles.playerLabel}>🔴 Красный</span>
            {turn.currentPlayer === 'red' && <span className={styles.activeBadge}>ходит</span>}
          </div>
          <div className={styles.hearts}>{renderHearts(redPlayer.lives, config.maxLives)}</div>
        </div>

        <div className={[
          styles.playerCard, styles.blue,
          turn.currentPlayer === 'blue' ? styles.activePlayer : styles.inactivePlayer,
        ].join(' ')}>
          <div className={styles.playerHeader}>
            <span className={styles.playerLabel}>🔵 Синий</span>
            {turn.currentPlayer === 'blue' && <span className={styles.activeBadge}>ходит</span>}
          </div>
          <div className={styles.hearts}>{renderHearts(bluePlayer.lives, config.maxLives)}</div>
        </div>
      </div>

      {/* Текущая фаза (только во время игры) */}
      {!isFinished && !isSetup && (
        <div className={styles.phaseBox}>
          <div className={styles.phaseTitle}>{PHASE_LABELS[turn.phase] ?? turn.phase}</div>
          {isMyTurn && <div className={styles.phaseDesc}>{PHASE_DESCRIPTIONS[turn.phase]}</div>}
        </div>
      )}

      {/* Подготовка — статус расстановки мин */}
      {isSetup && (
        <div className={styles.phaseBox}>
          <div className={styles.phaseTitle}>Подготовка — расстановка мин</div>
          <div className={styles.phaseDesc}>
            {iConfirmed ? (
              <>
                Расстановка подтверждена.{' '}
                {opponentConfirmed
                  ? 'Оба готовы, начинаем...'
                  : `Ожидание ${opponent?.name ?? 'противника'}...`}
              </>
            ) : (
              <>
                Поставьте <strong>{config.initialMines}</strong> мин на доступные клетки своей половины.
                {' '}🏛️ — штаб (нельзя заминировать).
              </>
            )}
          </div>
          <div className={styles.phaseDesc} style={{ marginTop: 6 }}>
            Поставлено: <strong>{me?.minesPlaced ?? 0} / {config.initialMines}</strong>
            {!iConfirmed && minesLeft > 0 && <> · осталось <strong>{minesLeft}</strong></>}
          </div>
          <div className={styles.phaseDesc} style={{ marginTop: 6 }}>
            Противник:{' '}
            {opponentConfirmed
              ? <strong style={{ color: '#2ecc71' }}>✓ готов</strong>
              : <strong style={{ color: '#f39c12' }}>⏳ расставляет...</strong>}
          </div>
        </div>
      )}

      {/* Причина окончания */}
      {isFinished && reason && (
        <div className={styles.phaseBox}>
          <div className={styles.phaseTitle}>Игра окончена</div>
          <div className={styles.phaseDesc}>
            {reason === 'lives' && 'Причина: потеряны все жизни'}
            {reason === 'headquarters' && 'Причина: захвачен штаб'}
            {reason === 'territory' && 'Причина: истёк лимит ходов, больше территории у победителя'}
          </div>
        </div>
      )}

      {/* Сообщение */}
      {turn.lastActionMessage && (
        <div className={[
          styles.actionMessage,
          turn.lastActionMessage.startsWith('💥') ? styles.messageDanger  :
          turn.lastActionMessage.startsWith('⚠️') ? styles.messageWarning :
          styles.messageSuccess,
        ].join(' ')}>
          {turn.lastActionMessage}
        </div>
      )}

      {/* Разминирование */}
      {!isFinished && turn.phase === 'phase2' && (
        <div className={`${styles.defuseStatus} ${turn.canDefuse ? styles.defuseAvailable : styles.defuseUsed}`}>
          {turn.canDefuse
            ? `🔧 Разминирований доступно: ${defusesLeftThisTurn} / ${turn.defusesPerTurn}`
            : `🔧 Разминирования использованы: ${turn.defusesUsedThisTurn} / ${turn.defusesPerTurn}`}
        </div>
      )}
    </div>
  );
}
