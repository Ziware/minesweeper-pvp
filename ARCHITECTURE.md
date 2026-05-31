# Архитектура проекта

Проект организован как **yarn workspaces** монорепозиторий из четырёх пакетов: `shared`, `backend`, `frontend` и `content`. Они связаны TypeScript Project References + path-alias `@minesweeper-pvp/shared`, что позволяет фронтенду и бэкенду пользоваться одной системой типов и геометрических помощников.

```
minesweeper-pvp/
├── package.json              # корневой workspace, общие скрипты
├── tsconfig.base.json        # общие TS-настройки (strict, esnext, …)
├── docker-compose.yml        # backend (Node) + frontend (nginx)
├── deploy.sh                 # build + docker compose up
├── README.md                 # правила игры
├── ARCHITECTURE.md           # этот файл
└── packages/
    ├── shared/               # общие типы и helpers
    ├── backend/              # Node.js + Socket.IO сервер
    ├── frontend/             # React + Vite клиент
    └── content/              # статические ассеты (звуки, SVG-иконки)
```

---

## 📦 `packages/shared`

Чистый TypeScript-пакет без рантайм-зависимостей. Содержит контракт между клиентом и сервером и универсальные геометрические утилиты доски.

| Файл | Назначение |
| --- | --- |
| [`src/types.ts`](packages/shared/src/types.ts) | Все типы данных: `CellState`, `ClientCellState`, `PlayerState`, `GameConfig`, `BoardStats`, `TurnState`, `GamePhase`, события Socket.IO (`ServerToClientEvents`, `ClientToServerEvents`), payload-ы `S2C_GameState`, `S2C_GameOver`. |
| [`src/board.ts`](packages/shared/src/board.ts) | Чистые helpers, не зависящие от конкретного представления клетки (generic): проверки границ (`isInBounds`), зоны 3×3 и 5×5 (`getActionZoneTopLeft`, `getDisplayZoneTopLeft`, `inZoneWithCenter`, `inZoneTopLeft`), штаб (`getHeadquartersCells`, `isHeadquartersCell`, `getHeadquartersCellOf`, `getHeadquartersOwner`), BFS по своим клеткам от штаба (`getReachablePlayerCells`, `isPlayerCellReachable`), ключ клетки `cellKey`, константы `ORTHOGONAL_DIRECTIONS`, `DISPLAY_ZONE_SIZE`, `ACTION_ZONE_SIZE`. |
| [`src/index.ts`](packages/shared/src/index.ts) | Barrel-реэкспорт всего публичного API. |

Используется одновременно бэкендом (как готовый `dist` через project references) и фронтендом (как path-alias на исходники, чтобы Vite их подтягивал напрямую).

---

## 🖥 `packages/backend`

Node.js-сервер на Express + Socket.IO. Хранит состояние комнат в памяти, валидирует все ходы, рассылает обновлённое состояние клиентам.

| Файл | Назначение |
| --- | --- |
| [`src/index.ts`](packages/backend/src/index.ts) | Точка входа. Поднимает Express + Socket.IO, регистрирует обработчики событий (`createRoom`, `joinRoom`, `restoreSession`, `placeMineSetup`, `confirmSetup`, `selectZone`, `captureCell`, `defuseCell`, `endPhase2`, `placeMinePhase3`, `endPhase3`, `toggleMark`, `disconnect`). Каждый обработчик дергает соответствующий метод `RoomManager` и рассылает `gameState` / `error` всем игрокам комнаты. |
| [`src/roomManager.ts`](packages/backend/src/roomManager.ts) | Сердце сервера. Класс `RoomManager` хранит мапу комнат, управляет жизненным циклом (создание, присоединение, восстановление сессии по `tabId`, удаление пустых комнат через таймер), валидирует ходы и формирует ошибки на русском (`"Это не ваша клетка"`, `"Штаб нельзя заминировать"`, `"Достигнут лимит мин для расстановки"` и т. д.). Здесь реализованы все правила: расстановка мин, переключение фаз, проверка захвата штаба и финальный подсчёт территории. |
| [`src/gameLogic.ts`](packages/backend/src/gameLogic.ts) | Чистые функции работы с доской: `createBoard`, `initBoard`, `countAdjacentEnemyMines`, `revealNumbersInDisplayZone`, `refreshNumbersInDisplayZone`, `clearRevealedNumbers`, `isValidZoneSelection`, `canCaptureCell`, `actionZoneContainsHeadquarters`, `computeBoardStats`, `getBoardForPlayer`, `createInitialTurnState`. Активно использует шарные helpers вместо собственных реализаций. |
| [`src/gameLogger.ts`](packages/backend/src/gameLogger.ts) | Per-room файловые логи (директория `logs/<roomId>-<player1>-vs-<player2>/`). Пишет события (`gameStarted`, `move`, `mineExploded`, `gameFinished`, …) и метаданные комнаты. |
| `Dockerfile` | Двухстадийная сборка: ставит зависимости, выполняет `tsc`, запускает `node dist/index.js`. |

Состояние комнаты содержит: доску `CellState[][]`, `players[]` с цветом/жизнями/именем, текущий ход (`TurnState`), фазу (`GamePhase`), счётчик ходов, флаги завершения, `GameLogger`.

---

## 🎨 `packages/frontend`

React SPA на Vite. Соединяется с бэкендом по WebSocket. Локально хранит только пользовательские настройки и идентификатор вкладки (`tabId`) — всё остальное приходит с сервера.

### Точки входа

| Файл | Назначение |
| --- | --- |
| [`src/main.tsx`](packages/frontend/src/main.tsx) | Bootstraps React в `#root`. |
| [`src/App.tsx`](packages/frontend/src/App.tsx) | Главный компонент-роутер. Управляет переходами между экранами (`lobby` → `waiting` → `game` → `finished`), рендерит общий «шелл» (хедер с кнопками настроек/правил), подключает звуки через `useSound` и эффекты-цепочки приоритетов (победа/поражение/взрыв > обычные клики). Обрабатывает горячие клавиши (Space — primary action, Esc — закрыть модалки). |
| [`src/index.css`](packages/frontend/src/index.css) | Глобальные стили и CSS-переменные (палитра красного/синего). |

### Хуки

| Файл | Назначение |
| --- | --- |
| [`src/hooks/useSocket.ts`](packages/frontend/src/hooks/useSocket.ts) | Создаёт `Socket.IO` клиент, хранит состояние экранов и игры. Восстанавливает сессию из `localStorage` (по `tabId` + `roomId` + `playerColor`). Слушает события сервера (`gameState`, `gameOver`, `error`, `sessionInvalid`, …) и предоставляет методы (`createRoom`, `joinRoom`, `selectZone`, `captureCell`, `defuseCell`, `placeMineSetup`, `confirmSetup`, `placeMinePhase3`, `endPhase2`, `endPhase3`, `toggleMark`, `returnToMenu`). |
| [`src/hooks/useSound.ts`](packages/frontend/src/hooks/useSound.ts) | Web Audio API обёртка: загружает 8 `.wav` из `packages/content/` лениво, воспроизводит с учётом `mutedRef` и `volumeRef` (refs, чтобы избежать пересоздания контекста). Поддерживает preload по требованию. |
| [`src/hooks/useSettings.ts`](packages/frontend/src/hooks/useSettings.ts) | Хранит пользовательские настройки (`muted`, `volume`, `hideControls`) в `localStorage` под ключом `minesweeper_settings`, экспонирует сеттеры. |

### Компоненты

| Файл | Назначение |
| --- | --- |
| [`src/components/Lobby/Lobby.tsx`](packages/frontend/src/components/Lobby/Lobby.tsx) | Стартовый экран: имя игрока, создание комнаты и присоединение по коду. |
| [`src/components/Board/Board.tsx`](packages/frontend/src/components/Board/Board.tsx) | Игровая доска: отрисовка ячеек, обработка кликов с учётом текущей фазы. В фазе расстановки и в фазе 3 любые клики уходят на сервер — он сам решает, валидны они или вернёт ошибку (которая всплывает как тост). Для отображения зон использует шарные helpers (`inZoneWithCenter`). Адаптивный размер ячейки через ResizeObserver. |
| [`src/components/Cell/Cell.tsx`](packages/frontend/src/components/Cell/Cell.tsx) | Один тайл доски: цвет владельца, маркеры (флаг/?), цифра-подсказка, мина, статусы (revealed, headquarters, hover-zone). |
| [`src/components/GameInfo/GameInfo.tsx`](packages/frontend/src/components/GameInfo/GameInfo.tsx) | Боковая панель. Через проп `section` рендерится дважды: слева — controls (текущая фаза, primary-кнопка, лимиты разминирования/мин), справа — stats (жизни, ходы, баланс территории, имя соперника). Включает экран финиша с баннером победителя и кнопкой «В меню». |
| [`src/components/HelpModal/HelpModal.tsx`](packages/frontend/src/components/HelpModal/HelpModal.tsx) | Модальное окно правил игры (это же источник истины для README). |
| [`src/components/SettingsMenu/SettingsMenu.tsx`](packages/frontend/src/components/SettingsMenu/SettingsMenu.tsx) | Выпадающее меню настроек: mute/unmute, слайдер громкости (кастомный `range` с 16px-thumb), переключатель «скрыть подсказки управления». Закрывается по клику вне (с защитой от race с кнопкой-якорем через атрибут `data-settings-anchor`). |
| [`src/components/Icon/Icon.tsx`](packages/frontend/src/components/Icon/Icon.tsx) | Универсальная inline-иконка для SVG из `packages/content` (`mine`, `headquarters`). Импортирует SVG через Vite `?url`, рендерит `<img>` с настраиваемым размером, ведёт себя как emoji по вертикальному выравниванию. Используется в `Cell`, `Board`, `GameInfo`, `HelpModal`, шапке `App`. |

### Конфигурация

| Файл | Назначение |
| --- | --- |
| [`vite.config.ts`](packages/frontend/vite.config.ts) | Алиас `@minesweeper-pvp/shared` → `../shared/src/index`, прокси `/socket.io` на бэкенд в dev. |
| [`tsconfig.json`](packages/frontend/tsconfig.json) | Project references на `shared`, тот же path-alias для tsc. |
| `nginx.conf` / `Dockerfile` | Образ статики: Vite-сборка раздаётся nginx-ом, `/socket.io` проксируется на backend-контейнер. |

---

## 🎵 `packages/content`

Папка со статическими ассетами, импортируется фронтендом через Vite (`?url`).

Звуки:

```
button.wav  defeat.wav  disarm.wav  explosion.wav
locked_cell.wav  plant_mine.wav  scan.wav  victory.wav
```

SVG-иконки:

```
mine-icon.svg            # символ мины (вместо emoji 💣)
headquarters-icon.svg    # символ штаба (вместо emoji 🏛️)
```

`useSound` загружает звуки лениво и воспроизводит по событиям из `App.tsx` (с приоритетной цепочкой — победный/проигрышный звук гасит остальные). SVG-иконки прокидываются через компонент [`Icon`](packages/frontend/src/components/Icon/Icon.tsx) и используются везде, где раньше стояли тематические emoji мины/штаба.

---

## 🔁 Поток данных

1. **Подключение.** Клиент шлёт `restoreSession` (если в `localStorage` есть `tabId`+`roomId`+`color`) или `createRoom`/`joinRoom`.
2. **Действие игрока.** UI вызывает метод `useSocket` → emit события (`selectZone`, `captureCell`, `placeMinePhase3`, …).
3. **Валидация.** `index.ts` бэкенда дёргает соответствующий метод `RoomManager`. При невалидном ходе сервер отвечает `socket.emit('error', { message })` — фронт показывает тост (3 сек).
4. **Бродкаст.** При успехе `broadcastGameState(roomId)` собирает персонализированный `S2C_GameState` для каждого игрока (скрывая чужие мины) и шлёт обоим. При завершении игры — дополнительно `S2C_GameOver`.
5. **Рендер.** `useSocket` сохраняет состояние, `App` перерисовывает `Board` + `GameInfo`. Звуки запускаются в эффектах, реагирующих на изменение фазы/жизней/чисел захваченных клеток.

---

## 🧠 Принципы разделения ответственности

- **Source of truth — сервер.** Клиент не предсказывает правила и не блокирует «неправильные» клики самостоятельно (кроме очевидных no-op вроде клика по уже захваченной клетке в фазе 2). Все валидации и сообщения об ошибках централизованы в `RoomManager`.
- **Чистые модули.** `gameLogic.ts` и `shared/board.ts` — без побочных эффектов и без `Date.now()`/IO, что делает их легко тестируемыми.
- **Общие helpers.** Любая геометрия доски (штаб, зоны, BFS по своим клеткам) живёт в `shared/board.ts`, чтобы фронт и бэк не расходились.
- **Без cookies.** Состояние сессии и пользовательские настройки — только в `localStorage`. На сервере хранится в памяти комнаты + файловый лог.
- **Аудио-refs.** `mutedRef`/`volumeRef` — refs (не state), чтобы изменения настроек не пересоздавали `AudioContext` и не сбрасывали кэш буферов.
