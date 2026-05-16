import React, { useState } from 'react';
import { useSocket } from './hooks/useSocket';
import { Lobby }     from './components/Lobby/Lobby';
import { MineSetup } from './components/MineSetup/MineSetup';
import { Board }     from './components/Board/Board';
import { GameInfo }  from './components/GameInfo/GameInfo';
import { HelpModal } from './components/HelpModal/HelpModal';
import styles from './App.module.css';

export default function App() {
  const {
    screen, roomId, myColor, myName, gameState, errorMsg, gameOver,
    createRoom, joinRoom,
    placeMineSetup, confirmSetup,
    selectZone, captureCell, defuseCell, endPhase2, placeMinePhase3, toggleMark,
  } = useSocket();

  const [showHelp, setShowHelp] = useState(false);

  if (screen === 'lobby') {
    return <Lobby onCreateRoom={createRoom} onJoinRoom={joinRoom} errorMsg={errorMsg} />;
  }

  if (screen === 'waiting') {
    return (
      <div className={styles.centered}>
        <div className={styles.waitCard}>
          <h2>⏳ Ожидание противника...</h2>
          <p>ID комнаты: <strong className={styles.roomId}>{roomId}</strong></p>
          <p>Поделитесь ID с другом!</p>
        </div>
      </div>
    );
  }

  if (screen === 'setup' && gameState && myColor) {
    return (
      <MineSetup
        gameState={gameState}
        myColor={myColor}
        onPlaceMine={placeMineSetup}
        onConfirm={confirmSetup}
        errorMsg={errorMsg}
      />
    );
  }

  if (screen === 'finished') {
    const winner   = gameOver?.winnerColor ?? gameState?.winnerColor;
    const isWinner = winner === myColor;
    const winnerPlayer = gameState?.players.find((p) => p.color === winner);
    return (
      <div className={styles.centered}>
        <div className={styles.waitCard}>
          <h1>{isWinner ? '🏆 Победа!' : '💀 Поражение!'}</h1>
          <p>
            Победитель:{' '}
            <span style={{ color: winner === 'red' ? '#e74c3c' : '#3498db' }}>
              {winner === 'red' ? '🔴' : '🔵'} {winnerPlayer?.name ?? winner}
            </span>
          </p>
          {gameOver?.reason === 'lives'          && <p>Причина: потеряны все жизни</p>}
          {gameOver?.reason === 'no_mines_space' && <p>Причина: нет места для мин</p>}
          <button className={styles.replayBtn} onClick={() => window.location.reload()}>
            Играть снова
          </button>
        </div>
      </div>
    );
  }

  if (screen === 'game' && gameState && myColor) {
    const me       = gameState.players.find((p) => p.color === myColor);
    const opponent = gameState.players.find((p) => p.color !== myColor);

    return (
      <div className={styles.gameLayout}>
        <div className={styles.gameHeader}>
          <h2 className={styles.logo}>💣 Minesweeper PvP</h2>
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

          <button className={styles.helpBtn} onClick={() => setShowHelp(true)}>
            ❓ Правила
          </button>
        </div>

        <div className={styles.gameBody}>
          <GameInfo  gameState={gameState} myColor={myColor} onEndPhase2={endPhase2} />
          <Board
            gameState={gameState}
            myColor={myColor}
            onSelectZone={selectZone}
            onCaptureCell={captureCell}
            onDefuseCell={defuseCell}
            onPlaceMinePhase3={placeMinePhase3}
            onToggleMark={toggleMark}
          />
          <div className={styles.legend}>
            <h3>Управление</h3>
            <div>🖱️ ЛКМ — действие</div>
            <div>🖱️ ПКМ — флаг / ? / убрать</div>
            <div>⌨️ Ctrl+Click — разминировать</div>
            <hr />
            <h3>Фазы хода</h3>
            <div>1️⃣ Выбор зоны 3×3</div>
            <div>2️⃣ Захват (зона 5×5)</div>
            <div>3️⃣ Поставить 3 мины</div>
          </div>
        </div>

        {errorMsg && <div className={styles.toastError}>{errorMsg}</div>}
        {showHelp  && <HelpModal onClose={() => setShowHelp(false)} />}
      </div>
    );
  }

  return null;
}
