import React, { useState, useCallback } from 'react';
import {
  S2C_GameState,
  PlayerColor,
  CellMark,
  inZoneWithCenter,
  isHeadquartersCell as sharedIsHeadquartersCell,
  summarizeChord as sharedSummarizeChord,
  getReachablePlayerCells as sharedGetReachablePlayerCells,
  cellKey,
} from '@minesweeper-pvp/shared';
import { Cell } from '../Cell/Cell';
import { Icon } from '../Icon/Icon';
import styles from './Board.module.css';

/**
 * Альтернативный режим обработки тапа по клетке. На мобиле, где нет ПКМ
 * и Ctrl, мы даём пользователю переключаемые «залипающие» кнопки:
 *   - 'flag'   → тап работает как ПКМ (цикл флага/вопроса/пусто).
 *   - 'defuse' → тап работает как Ctrl+ЛКМ (попытка разминировать).
 *   - 'normal' → обычное поведение (захват / выбор зоны / установка мины).
 */
export type MobileInputMode = 'normal' | 'flag' | 'defuse';

interface BoardProps {
  gameState: S2C_GameState;
  myColor: PlayerColor;
  onSelectZone: (row: number, col: number) => void;
  onCaptureCell: (row: number, col: number) => void;
  onDefuseCell: (row: number, col: number) => void;
  onPlaceMinePhase3: (row: number, col: number) => void;
  onPlaceMineSetup?: (row: number, col: number) => void;
  onToggleMark: (row: number, col: number, mark: CellMark) => void;
  /** Аккорд: клик по своей открытой цифре с верным числом флажков. */
  onChord?: (row: number, col: number) => void;
  /** Локальная ошибка интерфейса (например, «слишком много флажков»). */
  onLocalError?: (message: string) => void;
  onWrapperRef?: (el: HTMLDivElement | null) => void;
  /** Текущий режим тапа в мобильной раскладке. На десктопе обычно 'normal'. */
  mobileInputMode?: MobileInputMode;
}

// Вычисляем размер клетки в зависимости от размера экрана и boardSize
/**
 * Подбираем размер клетки доски под текущий экран.
 *
 * Десктоп (>= 900px): три колонки бок о бок, поэтому из ширины окна вычитаем
 *   две боковые панели по 260px и gap'ы. По высоте — шапка, нижний бар, паддинги.
 *   Размер клетки ограничиваем сверху 64px (чтобы доска не «плыла» на 4K) и
 *   снизу 32px (минимально кликабельно на тач-устройстве с мышью).
 *
 * Мобильный (< 900px): раскладка вертикальная (доска во всю ширину),
 *   боковых колонок нет — используем почти всю ширину окна. По высоте
 *   не ограничиваем — страница скроллится. Минимальный размер опускаем
 *   до 24px, чтобы поле 16×16 умещалось в ширину iPhone SE.
 */
function useCellSize(boardSize: number): number {
  const [cellSize, setCellSize] = React.useState(44);

  React.useEffect(() => {
    function calc() {
      const isMobile = window.innerWidth < 900;
      let size: number;
      if (isMobile) {
        // На мобиле доска во всю ширину; по высоте не лимитируем.
        const horizontalPadding = 20; // 10px gameBody padding × 2
        const boardInnerPad = 16;     // .board padding 8px × 2
        const availW = window.innerWidth - horizontalPadding - boardInnerPad;
        const maxByW = Math.floor((availW - (boardSize - 1) * 2) / boardSize);
        size = Math.max(24, Math.min(48, maxByW));
      } else {
        // Десктоп — место для двух боковых колонок 260px + gaps + padding.
        const reservedW = 260 * 2 + 24 * 3 + 32;
        const reservedH = 60 + 44 + 80; // header + bottomBar + padding
        const availW = window.innerWidth  - reservedW;
        const availH = window.innerHeight - reservedH;
        const maxByW = Math.floor(availW / boardSize);
        const maxByH = Math.floor(availH / boardSize);
        size = Math.max(32, Math.min(64, maxByW, maxByH));
      }
      setCellSize(size);
    }
    calc();
    window.addEventListener('resize', calc);
    window.addEventListener('orientationchange', calc);
    return () => {
      window.removeEventListener('resize', calc);
      window.removeEventListener('orientationchange', calc);
    };
  }, [boardSize]);

  return cellSize;
}

export function Board({
  gameState,
  myColor,
  onSelectZone,
  onCaptureCell,
  onDefuseCell,
  onPlaceMinePhase3,
  onPlaceMineSetup,
  onToggleMark,
  onChord,
  onLocalError,
  onWrapperRef,
  mobileInputMode = 'normal',
}: BoardProps) {
  const { board, turn, config, players } = gameState;
  const isMyTurn = turn.currentPlayer === myColor;

  const cellSize = useCellSize(config.boardSize);

  const isFinished = turn.phase === 'finished' || !!gameState.winnerColor;
  const me = players.find((p) => p.color === myColor);
  const iConfirmed = me?.setupConfirmed ?? false;

  const myInitialMines = myColor === 'red'
    ? config.initialMinesRed
    : config.initialMinesBlue;
  const myMinesPlaced = me?.minesPlaced ?? 0;
  const defusesLeft = Math.max(0, turn.defusesPerTurn - turn.defusesUsedThisTurn);
  const baseMines = config.minesPerTurn;
  const minesBonus = Math.max(0, turn.minesAllowedThisTurn - config.minesPerTurn);

  // Центр зон из selectedZone/actionZone (скрываем после окончания игры)
  const displayCenter = !isFinished && turn.selectedZone
    ? { row: turn.selectedZone.row + 1, col: turn.selectedZone.col + 1 }
    : null;
  const actionCenter = !isFinished && turn.actionZone
    ? { row: turn.actionZone.row + 2, col: turn.actionZone.col + 2 }
    : null;

  const [hoverCell, setHoverCell] = useState<{ row: number; col: number } | null>(null);
  /** Клетка, по которой сейчас зажат пойнтер. Используется для предпросмотра
   *  аккорда: пока пользователь держит кнопку — показываем тинт на клетках,
   *  которые попытается открыть аккорд (с учётом flood-fill). */
  const [pressedCell, setPressedCell] = useState<{ row: number; col: number } | null>(null);

  // Глобальные слушатели pointerup/pointercancel/blur — снимаем «прижатость»
  // даже если пользователь отпустил палец/кнопку вне клетки.
  React.useEffect(() => {
    const clear = () => setPressedCell(null);
    window.addEventListener('pointerup', clear);
    window.addEventListener('pointercancel', clear);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('pointerup', clear);
      window.removeEventListener('pointercancel', clear);
      window.removeEventListener('blur', clear);
    };
  }, []);

  /** Координаты клетки, на которой только что взорвалась мина — используем
   *  для анимации вспышки. Сбрасывается через ~1 секунду. Идентификатор
   *  события (`turn.lastAction.id`) позволяет перезапустить анимацию даже
   *  если повторно взорвалась мина на той же клетке. */
  const [explodingCell, setExplodingCell] = useState<{ row: number; col: number; key: number } | null>(null);
  const lastExplosionIdRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    const action = turn.lastAction;
    if (!action || action.type !== 'mine_exploded') return;
    if (typeof action.row !== 'number' || typeof action.col !== 'number') return;
    const id = typeof action.id === 'number' ? action.id : null;
    if (id === null) return;
    if (lastExplosionIdRef.current === id) return;
    lastExplosionIdRef.current = id;
    setExplodingCell({ row: action.row, col: action.col, key: id });
    const t = window.setTimeout(() => {
      setExplodingCell((prev) => (prev && prev.key === id ? null : prev));
    }, 1000);
    return () => {
      window.clearTimeout(t);
    };
  }, [turn.lastAction]);

  const isInDisplayZone = useCallback(
    (r: number, c: number) =>
      displayCenter !== null &&
      inZoneWithCenter(r, c, displayCenter.row, displayCenter.col, 1),
    [displayCenter]
  );

  const isInActionZone = useCallback(
    (r: number, c: number) =>
      actionCenter !== null &&
      inZoneWithCenter(r, c, actionCenter.row, actionCenter.col, 2),
    [actionCenter]
  );

  const isInHoverDisplay = (r: number, c: number) =>
    hoverCell !== null && isMyTurn && turn.phase === 'phase1' &&
    inZoneWithCenter(r, c, hoverCell.row, hoverCell.col, 1);

  const isInHoverAction = (r: number, c: number) =>
    hoverCell !== null && isMyTurn && turn.phase === 'phase1' &&
    inZoneWithCenter(r, c, hoverCell.row, hoverCell.col, 2);

  const cycleMark = (current: CellMark): CellMark => {
    const next: Record<CellMark, CellMark> = {
      none: 'flag', flag: 'question', question: 'none',
    };
    return next[current];
  };

  /** Сводка по аккорду — общая функция с бэкендом, чтобы превью на клиенте
   *  и реальный захват на сервере всегда совпадали. Для проверки достижимости
   *  считаем «свою» BFS-связную область заранее (её результат стабилен в
   *  пределах одного рендера). */
  const reachableOwnKeys = React.useMemo(
    () => sharedGetReachablePlayerCells(board, myColor, config.boardSize),
    [board, myColor, config.boardSize],
  );
  const summarizeChord = (r: number, c: number) =>
    sharedSummarizeChord(r, c, {
      boardSize: config.boardSize,
      isFlag:         (rr, cc) => board[rr]?.[cc]?.mark === 'flag',
      isOwnedByActor: (rr, cc) => board[rr]?.[cc]?.owner === myColor,
      isReachableOwn: (rr, cc) => reachableOwnKeys.has(cellKey(rr, cc)),
    });

  /** Проверяем, является ли клетка (r, c) подходящей для аккорда:
   *  это моя открытая клетка в зоне 3×3 с цифрой (≥ 0), и сейчас фаза 2 + мой ход.
   *  Цифра 0 тоже допустима — аккорд раскроет соседей напрямую. */
  const isChordSource = (r: number, c: number): boolean => {
    if (turn.phase !== 'phase2' || !isMyTurn) return false;
    const cell = board[r][c];
    if (cell.owner !== myColor) return false;
    if (!cell.isRevealed) return false;
    if (cell.number === null) return false;
    if (!isInDisplayZone(r, c)) return false;
    return true;
  };

  // Множество (row,col) клеток, которые подсвечиваются как кандидаты аккорда
  // ПОКА ПОЛЬЗОВАТЕЛЬ ДЕРЖИТ КНОПКУ на клетке-источнике. Если кнопка не зажата
  // или источник не подходит для аккорда — множество пустое.
  const chordPreviewSet = React.useMemo(() => {
    const set = new Set<string>();
    if (!pressedCell) return set;
    if (!isChordSource(pressedCell.row, pressedCell.col)) return set;
    const { candidates } = summarizeChord(pressedCell.row, pressedCell.col);
    for (const { row, col } of candidates) {
      set.add(`${row},${col}`);
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressedCell, board, turn.phase, isMyTurn]);

  const handleClick = (r: number, c: number, e: React.MouseEvent) => {
    if (turn.phase === 'finished') return;
    const cell  = board[r][c];
    const phase = turn.phase;

    // Мобильный режим «флаг»: любой тап превращается в цикл флага/вопроса
    // (как ПКМ), кроме setup-фазы — там флаги не нужны.
    if (mobileInputMode === 'flag' && phase !== 'setup') {
      onToggleMark(r, c, cycleMark(cell.mark));
      return;
    }

    if (phase === 'setup') {
      if (iConfirmed) return;
      if (!onPlaceMineSetup) return;
      // Шлём любой клик на сервер: тот вернёт причину, если ход неверный
      // ("Это не ваша клетка", "Штаб нельзя заминировать",
      // "Мины можно ставить только в доступные клетки",
      // "Достигнут лимит мин для расстановки" и т. п.).
      onPlaceMineSetup(r, c);
      return;
    }

    if (!isMyTurn) return;

    if (phase === 'phase1') {
      onSelectZone(r, c);
      return;
    }
    if (phase === 'phase2') {
      // Аккорд: клик по своей открытой цифре в зоне 3×3 в фазе 2.
      //   - флажков == цифре → отправляем chord на сервер;
      //   - флажков > цифры  → локальная ошибка «слишком много флажков»;
      //   - флажков < цифры  → молча игнорируем (есть только подсветка hover-превью).
      if (isChordSource(r, c)) {
        const { flagCount, candidates, unflaggedClosedNeighbors } = summarizeChord(r, c);
        const need = cell.number ?? 0;
        if (flagCount === need) {
          if (candidates.length > 0) {
            onChord?.(r, c);
          }
          return;
        }
        if (flagCount > need) {
          onLocalError?.('Слишком много флажков для аккорда');
          return;
        }
        // Авто-флаг: если суммарное число закрытых соседей (флажки + без флага)
        // ровно равно цифре — все закрытые гарантированно мины, расставляем
        // флажки автоматически. Это локальное действие клиента; сервер
        // получит обычные toggleMark и проставит метки.
        if (
          unflaggedClosedNeighbors.length > 0 &&
          flagCount + unflaggedClosedNeighbors.length === need
        ) {
          for (const { row: fr, col: fc } of unflaggedClosedNeighbors) {
            onToggleMark(fr, fc, 'flag');
          }
          return;
        }
        // flagCount < need и больше закрытых соседей нет смысла «угадывать» —
        // ничего не делаем, пусть пользователь расставит флажки сам.
        return;
      }
      // Клик по своей клетке без аккорда игнорируем тихо — это просто промах
      // (например, пользователь сматривается по полю). Любой другой клик
      // отправляем на сервер, чтобы тот прислал понятное сообщение об ошибке
      // (вне зоны 5×5 / нельзя разминировать свою / и т. п.).
      if (cell.owner === myColor) return;
      // Ctrl/Cmd на десктопе ИЛИ мобильный режим «разминировать» — попытка дефьюза.
      // Эти режимы должны работать даже на клетках с флажком/вопросом,
      // поэтому защита от случайных кликов по своим меткам срабатывает
      // ТОЛЬКО для обычного захвата, ниже.
      if (e.ctrlKey || e.metaKey || mobileInputMode === 'defuse') {
        onDefuseCell(r, c);
        return;
      }
      // Защита от случайного клика по своим меткам в фазе 2 при обычном
      // захвате:
      //   - флажок: пользователь сам пометил клетку как мину; обычный клик
      //     ничего не делает, иначе можно случайно подорваться. Снять флажок
      //     можно ПКМ или мобильной кнопкой «флаг».
      //   - знак вопроса: тап сбрасывает метку, не пытаясь захватить клетку.
      if (cell.mark === 'flag') return;
      if (cell.mark === 'question') {
        onToggleMark(r, c, 'none');
        return;
      }
      onCaptureCell(r, c);
      return;
    }
    if (phase === 'phase3') {
      // В фазе 3 шлём любой клик: сервер вернёт причину, если ход неверный
      // (не своя клетка, HQ, недостижима, уже заминирована и т. п.).
      onPlaceMinePhase3(r, c);
    }
  };

  const handleRightClick = (e: React.MouseEvent, r: number, c: number) => {
    e.preventDefault();
    if (turn.phase === 'finished') return;
    if (turn.phase === 'setup') return;
    const cell = board[r][c];
    onToggleMark(r, c, cycleMark(cell.mark));
  };

  const getZoneType = (r: number, c: number): 'display' | 'action' | 'none' => {
    if (isInDisplayZone(r, c)) return 'display';
    if (isInActionZone(r, c))  return 'action';
    return 'none';
  };

  const getHoverZoneType = (r: number, c: number): 'display' | 'action' | 'none' => {
    if (isInHoverDisplay(r, c)) return 'display';
    if (isInHoverAction(r, c))  return 'action';
    return 'none';
  };

  const showLegend = !!(displayCenter || (hoverCell && turn.phase === 'phase1' && isMyTurn));

  return (
    <div className={styles.wrapper} ref={onWrapperRef}>
      <div
        className={styles.board}
        style={{
          gridTemplateColumns: `repeat(${config.boardSize}, ${cellSize}px)`,
        }}
      >
        {board.map((row, r) =>
          row.map((cell, c) => {
            const activeZone = getZoneType(r, c);
            const hoverZone  = getHoverZoneType(r, c);
            const finalZone  = activeZone !== 'none' ? activeZone : hoverZone;
            const isHover    = activeZone === 'none' && hoverZone !== 'none';
            // Клетка в активной зоне (не превью) — скрываем мину
            const isInActive = activeZone !== 'none';

            return (
              <div
                key={`${r}-${c}`}
                style={{ width: cellSize, height: cellSize }}
                onMouseEnter={() => setHoverCell({ row: r, col: c })}
                onMouseLeave={() => setHoverCell(null)}
                onPointerDown={() => {
                  if (isChordSource(r, c)) {
                    setPressedCell({ row: r, col: c });
                  }
                }}
                onPointerLeave={() => {
                  // Если пользователь увёл палец/курсор с клетки во время
                  // удержания — снимаем подсветку.
                  setPressedCell((prev) =>
                    prev && prev.row === r && prev.col === c ? null : prev,
                  );
                }}
              >
                <Cell
                  cell={cell}
                  row={r}
                  col={c}
                  myColor={myColor}
                  zoneType={finalZone}
                  isHover={isHover}
                  isInActiveZone={isInActive}
                  isHeadquarters={sharedIsHeadquartersCell(r, c, config.boardSize)}
                  gamePhase={turn.phase}
                  isMyTurn={isMyTurn}
                  chordPreview={chordPreviewSet.has(`${r},${c}`)}
                  exploding={explodingCell !== null && explodingCell.row === r && explodingCell.col === c}
                  explosionKey={explodingCell && explodingCell.row === r && explodingCell.col === c ? explodingCell.key : undefined}
                  onClick={(e) => handleClick(r, c, e)}
                  onRightClick={(e) => handleRightClick(e, r, c)}
                />
              </div>
            );
          })
        )}
      </div>

      <div className={styles.bottomBar}>
        {(() => {
          // Игра окончена — единственная подсказка.
          if (isFinished) {
            return <div className={styles.hint}>Игра окончена</div>;
          }

          // Фаза расстановки мин на старте.
          if (turn.phase === 'setup') {
            if (iConfirmed) {
              return (
                <div className={styles.hint}>
                  Ожидание противника — он расставляет мины…
                </div>
              );
            }
            return (
              <div className={styles.hint}>
                Расставлено мин: <strong>{myMinesPlaced} / {myInitialMines}</strong>
              </div>
            );
          }

          // Не ваш ход в активной фазе.
          if (!isMyTurn) {
            return <div className={styles.hint}>Идёт ход противника…</div>;
          }

          // Фаза 1 — пояснение про зоны.
          if (turn.phase === 'phase1') {
            return (
              <div className={styles.zoneLegend}>
                <span className={styles.legendDisplay}>■ Зона 3×3 — подсказки</span>
                <span className={styles.legendAction}>■ Зона 5×5 — действия</span>
                <span className={styles.legendHeadquarters}>
                  <Icon name="headquarters" size="1.5em"/> Штаб
                </span>
              </div>
            );
          }

          // Фаза 2 — зоны + счётчик разминирований.
          if (turn.phase === 'phase2') {
            return (
              <>
                <div className={styles.zoneLegend}>
                  <span className={styles.legendDisplay}>■ Зона 3×3 — подсказки</span>
                  <span className={styles.legendAction}>■ Зона 5×5 — действия</span>
                </div>
                <div className={styles.hint}>
                  🔧 Разминирований осталось: <strong>{defusesLeft} / {turn.defusesPerTurn}</strong>
                </div>
              </>
            );
          }

          // Фаза 3 — мины и бонус за штаб.
          if (turn.phase === 'phase3') {
            return (
              <div className={styles.hint}>
                Расставлено мин: <strong>{turn.minesPlacedThisTurn} / {turn.minesAllowedThisTurn}</strong>
                {minesBonus > 0 && (
                  <> <span style={{ color: '#f0c040' }}>({baseMines} + {minesBonus} за штаб)</span></>
                )}
              </div>
            );
          }

          return <div className={styles.placeholder} />;
        })()}
      </div>
    </div>
  );
}
