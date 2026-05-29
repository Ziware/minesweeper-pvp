import React from 'react';
import { S2C_GameState, PlayerColor } from '@minesweeper-pvp/shared';
import styles from './GameInfo.module.css';

interface GameInfoProps {
  gameState: S2C_GameState;
  myColor: PlayerColor;
  onEndPhase2: () => void;
  onEndPhase3: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  phase1: 'Фаза 1 — выбор зоны 3×3',
  phase2: 'Фаза 2 — захват клеток',
  phase3: 'Фаза 3 — расстановка мин',
};

const PHASE_DESCRIPTIONS: Record<string, string> = {
  phase1: 'Кликните на поле, чтобы выбрать зону 3×3. В зоне должна быть хотя бы одна ваша доступная клетка, соединённая со штабом.',
  phase2: 'Захватывайте вражеские клетки в зоне 5×5 рядом с доступной клеткой. Ctrl+Click — разминировать.',
  phase3: 'Поставьте от 0 до 3 мин на свои свободные доступные клетки и завершите ход.',
};

const DEFUSE_GRANT_INTERVAL = 5;

export function GameInfo({ gameState, myColor, onEndPhase2, onEndPhase3 }: GameInfoProps) {
  const { players, turn, config, stats } = gameState;
  const isMyTurn = turn.currentPlayer === myColor;

  const totalTurnLimit = config.turnLimitPerPlayer * 2;
  const turnsUntilNextDefuse =
    DEFUSE_GRANT_INTERVAL - (turn.turnsPlayed % DEFUSE_GRANT_INTERVAL);
  const willGetMoreDefuses = turn.turnsPlayed + turnsUntilNextDefuse < totalTurnLimit;
  const defusesLeftThisTurn = Math.max(0, turn.defusesPerTurn - turn.defusesUsedThisTurn);

  const redPlayer  = players.find((p) => p.color === 'red')!;
  const bluePlayer = players.find((p) => p.color === 'blue')!;

  // Флажки — из доски
  const flagCount = gameState.board.flat().filter((c) => c.mark === 'flag').length;

  const renderHearts = (lives: number, max: number) =>
    Array.from({ length: max }, (_, i) => (
      <span key={i} className={i < lives ? styles.heartFull : styles.heartEmpty}>
        {i < lives ? '❤️' : '🖤'}
      </span>
    ));

  return (
    <div className={styles.panel}>
      {/* Статус хода */}
      <div className={`${styles.turnStatus} ${isMyTurn ? styles.myTurn : styles.opponentTurn}`}>
        <span className={styles.turnIcon}>{isMyTurn ? '⚔️' : '⏳'}</span>
        <span>{isMyTurn ? 'Ваш ход!' : 'Ход противника...'}</span>
      </div>

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

      {/* Текущая фаза */}
      <div className={styles.phaseBox}>
        <div className={styles.phaseTitle}>{PHASE_LABELS[turn.phase] ?? turn.phase}</div>
        {isMyTurn && <div className={styles.phaseDesc}>{PHASE_DESCRIPTIONS[turn.phase]}</div>}
      </div>

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

      {/* ===== Статистика — открытая для обоих ===== */}
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
            <strong>{turnsUntilNextDefuse} {turnsUntilNextDefuse === 1 ? 'ход' : 'ход(ов)'}</strong>
          </div>
        )}

        {/* Строка: мины */}
        <div className={styles.statHeader}>Мины на поле</div>
        <div className={styles.statRow}>
          <span className={styles.redLabel}>🔴 Красный:</span>
          <strong className={styles.redVal}>{stats.redMines}</strong>
        </div>
        <div className={styles.statRow}>
          <span className={styles.blueLabel}>🔵 Синий:</span>
          <strong className={styles.blueVal}>{stats.blueMines}</strong>
        </div>

        {/* Строка: клетки */}
        <div className={styles.statHeader}>Клеток во владении</div>
        <div className={styles.statRow}>
          <span className={styles.redLabel}>🔴 Красный:</span>
          <strong className={styles.redVal}>{stats.redCells}</strong>
        </div>
        <div className={styles.statRow}>
          <span className={styles.blueLabel}>🔵 Синий:</span>
          <strong className={styles.blueVal}>{stats.blueCells}</strong>
        </div>

        {/* Флажки */}
        <div className={styles.statDivider} />
        <div className={styles.statRow}>
          <span>🚩 Флажков:</span>
          <strong>{flagCount}</strong>
        </div>

        {/* Фаза 3 */}
        {turn.phase === 'phase3' && isMyTurn && (
          <div className={`${styles.statRow} ${styles.phase3Row}`}>
            <span>📍 Поставлено мин:</span>
            <strong>{turn.minesPlacedThisTurn} / {config.minesPerTurn}</strong>
          </div>
        )}
      </div>

      {/* Разминирование */}
      {turn.phase === 'phase2' && (
        <div className={`${styles.defuseStatus} ${turn.canDefuse ? styles.defuseAvailable : styles.defuseUsed}`}>
          {turn.canDefuse
            ? `🔧 Разминирований доступно: ${defusesLeftThisTurn} / ${turn.defusesPerTurn}`
            : `🔧 Разминирования использованы: ${turn.defusesUsedThisTurn} / ${turn.defusesPerTurn}`}
        </div>
      )}

      {/* Кнопка завершить фазу 2 */}
      {isMyTurn && turn.phase === 'phase2' && (
        <button className={styles.endPhaseBtn} onClick={onEndPhase2}>
          Завершить захват →
        </button>
      )}

      {/* Кнопка завершить фазу 3 */}
      {isMyTurn && turn.phase === 'phase3' && (
        <button className={styles.endPhaseBtn} onClick={onEndPhase3}>
          Завершить расстановку →
        </button>
      )}
    </div>
  );
}
