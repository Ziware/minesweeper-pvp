import React, { useEffect, useRef, useState } from 'react';
import { useSocket } from './hooks/useSocket';
import { useSound } from './hooks/useSound';
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
    selectZone, captureCell, defuseCell, endPhase2, endPhase3, placeMinePhase3, toggleMark,
  } = useSocket();

  const [showHelp, setShowHelp] = useState(false);
  const { muted, play, preload, toggleMuted } = useSound();
  const previousLivesRef = useRef<Record<string, number> | null>(null);
  const previousCapturedCountRef = useRef<number | null>(null);

  useEffect(() => {
    preload();
  }, [preload]);

  useEffect(() => {
    if (!gameState) return;

    const currentLives = Object.fromEntries(
      gameState.players.map((player) => [player.color, player.lives])
    );
    const previousLives = previousLivesRef.current;

    const hasExplosion = previousLives
      ? gameState.players.some(
        (player) => player.lives < (previousLives[player.color] ?? player.lives)
      )
      : false;

    if (hasExplosion) {
      play('explosion');
    } else if (
      previousCapturedCountRef.current !== null &&
      gameState.turn.capturedThisTurn.length > previousCapturedCountRef.current
    ) {
      play('click');
    }

    previousLivesRef.current = currentLives;
    previousCapturedCountRef.current = gameState.turn.capturedThisTurn.length;
  }, [gameState, play]);

  const playClick = () => play('click');

  const renderHeader = (content?: React.ReactNode) => (
    <div className={styles.gameHeader}>
      <h2 className={styles.logo}>💣 Minesweeper PvP</h2>
      {content}
      <div className={styles.headerActions}>
        <button
          className={styles.headerBtn}
          onClick={() => {
            playClick();
            toggleMuted();
          }}
          title={muted ? 'Включить звук' : 'Выключить звук'}
        >
          {muted ? '🔇 Звук' : '🔊 Звук'}
        </button>
        <button
          className={styles.headerBtn}
          onClick={() => {
            playClick();
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
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );

  if (screen === 'lobby') {
    return renderShell(
      <div className={styles.screenBody}>
        <Lobby
          onCreateRoom={(name) => {
            playClick();
            createRoom(name);
          }}
          onJoinRoom={(id, name) => {
            playClick();
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

  if (screen === 'setup' && gameState && myColor) {
    return renderShell(
      <MineSetup
        gameState={gameState}
        myColor={myColor}
        onPlaceMine={(row, col) => {
          playClick();
          placeMineSetup(row, col);
        }}
        onConfirm={() => {
          playClick();
          confirmSetup();
        }}
      />
    );
  }

  if (screen === 'finished') {
    const winner   = gameOver?.winnerColor ?? gameState?.winnerColor;
    const isWinner = winner === myColor;
    const winnerPlayer = gameState?.players.find((p) => p.color === winner);
    return renderShell(
      <div className={styles.centered}>
        <div className={styles.waitCard}>
          <h1>{isWinner ? '🏆 Победа!' : '💀 Поражение!'}</h1>
          <p>
            Победитель:{' '}
            <span style={{ color: winner === 'red' ? '#e74c3c' : '#3498db' }}>
              {winner === 'red' ? '🔴' : '🔵'} {winnerPlayer?.name ?? winner}
            </span>
          </p>
          {gameOver?.reason === 'lives'        && <p>Причина: потеряны все жизни</p>}
          {gameOver?.reason === 'headquarters' && <p>Причина: захвачен штаб</p>}
          {gameOver?.reason === 'territory'    && <p>Причина: истёк лимит ходов, больше территории у победителя</p>}
          <button
            className={styles.replayBtn}
            onClick={() => {
              playClick();
              window.location.reload();
            }}
          >
            Играть снова
          </button>
        </div>
      </div>
    );
  }

  if (screen === 'game' && gameState && myColor) {
    const me       = gameState.players.find((p) => p.color === myColor);
    const opponent = gameState.players.find((p) => p.color !== myColor);

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

    return renderShell(
      <div className={styles.gameBody}>
        <GameInfo
          gameState={gameState}
          myColor={myColor}
          onEndPhase2={() => {
            playClick();
            endPhase2();
          }}
          onEndPhase3={() => {
            playClick();
            endPhase3();
          }}
        />
        <Board
          gameState={gameState}
          myColor={myColor}
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
            playClick();
            placeMinePhase3(row, col);
          }}
          onToggleMark={(row, col, mark) => {
            playClick();
            toggleMark(row, col, mark);
          }}
        />
        <div className={styles.legend}>
          <h3>Управление</h3>
          <div>🖱️ ЛКМ — действие</div>
          <div>🖱️ ПКМ — флаг / ? / убрать</div>
          <div>⌨️ Ctrl+Click — разминировать</div>
          <div>🏰 Захват штаба — мгновенная победа</div>
          <hr />
          <h3>Фазы хода</h3>
          <div>1️⃣ Выбор зоны 3×3</div>
          <div>2️⃣ Захват по границе (зона 5×5)</div>
          <div>3️⃣ Поставить 0–3 мины</div>
        </div>
      </div>,
      headerContent
    );
  }

  return null;
}
