# Plan: Room Pages, Active Games, NavBar UX, Surrender

## Resolved Decisions

- **Bot state persistence**: YES — serialize `EngineState` to `localStorage` on every `LocalGameDriver.commit()`; restore on page refresh via `GameSessionContext`
- **Surrender from setup**: YES — `SurrenderButton` is visible from `setup` phase onwards (all non-finished states)
- **Room ID format**: 16-char mixed-case alphanumeric confirmed (no ambiguous chars)

---

## Overview

Eight linked improvements to navigation, routing, and in-game UX:

1. `/room/:id` dedicated page + 16-char room IDs
2. Invite link on waiting screen (instead of copy-code)
3. Bot games get a room ID too (navigation to `/room/:id`)
4. Active games persist across navigation; accessible from profile + header
5. Consistent logo across all pages (large HQ icon + "MsPvP", always links to `/`)
6. NavBar links left-aligned, hidden on game page
7. Surrender button with double-click + 3 s timeout (visible from setup onwards)
8. Bot engine state serialized to `localStorage` for refresh recovery

---

## Architecture Diagram

```mermaid
graph TD
  subgraph Router
    A[/ - LobbyPage App.tsx]
    B[/room/:roomId - RoomPage]
    C[/profile/:login - ProfilePage]
    D[/classic - ClassicPage]
    E[/rules - RulesPage]
  end

  subgraph Context root
    G[GameSessionProvider]
    G --> A
    G --> B
    G --> C
    G --> D
    G --> E
  end

  G -->|useSocket| SOCK[WebSocket to backend]
  G -->|useLocalGame| LOCAL[LocalGameDriver - bot]
  LOCAL -->|commit snapshot| LS[localStorage solo state]
  B -->|consumes| G
  A -->|consumes| G
  C -->|reads activeRooms| STORE[localStorage activeRooms]
```

---

## 1. Room ID — 16 Characters

### Backend: [`packages/backend/src/roomManager.ts`](packages/backend/src/roomManager.ts:96)

Rewrite [`generateRoomId()`](packages/backend/src/roomManager.ts:96):

```ts
generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 16; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}
```

- 16 chars from a 54-char alphabet → ~87 bits of entropy
- Remove the `.toUpperCase()` call in [`index.ts:199`](packages/backend/src/index.ts:199) — IDs are now case-sensitive
- No DB migration needed; room IDs are in-memory only

---

## 2. `/room/:id` Dedicated Page

### New: [`packages/frontend/src/pages/RoomPage/RoomPage.tsx`](packages/frontend/src/pages/RoomPage/RoomPage.tsx)

The route `/room/:roomId` renders `RoomPage`. It:
- Reads `roomId` from `useParams()`
- Consumes `GameSessionContext` (see §3) for all socket/game state
- On mount: if `gameState` exists for this room → show game; if `screen === 'waiting'` → show waiting UI; otherwise auto-joins (`joinRoom(roomId, playerName)`)
- Renders all game screens: **waiting → setup → game → finished**
- All game UI currently in [`App.tsx`](packages/frontend/src/App.tsx) (lines 550–912) moves here

### Invite link on waiting screen

Instead of showing the short code and "tell your friend", show the full invite URL:
```
https://mspvp.example.com/room/AbCdEfGhJkMnPqRs
```
- "Скопировать ссылку" button copies `window.location.href`
- No code entry needed — the URL encodes the room directly

### Bot games on `/room/:id`

When user starts a solo game in Lobby:
1. Generate `soloRoomId = 'solo_' + 11-char random` on the client
2. Call `context.startSolo(difficulty, humanColor, soloRoomId)` then `navigate('/room/' + soloRoomId)`
3. `RoomPage` detects `roomId.startsWith('solo_')` → uses local game state from context

---

## 3. GameSessionContext — Lifting State

### New: [`packages/frontend/src/context/GameSessionContext.tsx`](packages/frontend/src/context/GameSessionContext.tsx)

**Problem**: `useSocket()` and `useLocalGame()` currently live inside `App` component. They unmount when navigating away from `/`, killing the active game.

**Solution**: Move them into a `GameSessionProvider` wrapping the entire router. State survives navigation to `/profile/...`, `/classic`, etc.

```ts
interface GameSessionContextValue {
  // state
  screen: GameScreen;
  roomId: string;
  myColor: PlayerColor | null;
  gameState: S2C_GameState | null;
  gameOver: GameOverInfo | null;
  errorMsg: string;
  serverReachable: boolean;
  gameMode: 'pvp' | 'solo';
  restoring: boolean;
  // active rooms registry (§4)
  activeRooms: ActiveRoom[];
  // actions
  createRoom: (name: string, tc: TimeControl) => void;
  joinRoom: (id: string, name: string) => void;
  startSolo: (difficulty: Difficulty, humanColor: PlayerColor, soloRoomId: string) => void;
  returnToMenu: () => void;
  leaveRoom: () => void;
  surrender: () => void;
  // game actions (proxied from useSocket / useLocalGame)
  placeMineSetup: (row: number, col: number) => void;
  confirmSetup: () => void;
  selectZone: (row: number, col: number) => void;
  captureCell: (row: number, col: number) => void;
  defuseCell: (row: number, col: number) => void;
  chord: (row: number, col: number) => void;
  endPhase2: () => void;
  endPhase3: () => void;
  placeMinePhase3: (row: number, col: number) => void;
  toggleMark: (row: number, col: number, mark: CellMark) => void;
  showLocalError: (message: string) => void;
}
```

### [`packages/frontend/src/main.tsx`](packages/frontend/src/main.tsx) changes

```tsx
<BrowserRouter>
  <GameSessionProvider>
    <RouterApp />
  </GameSessionProvider>
</BrowserRouter>
```

Add route: `<Route path="/room/:roomId" element={<RoomPage />} />`

### [`packages/frontend/src/App.tsx`](packages/frontend/src/App.tsx) simplification

After extracting game screens to `RoomPage` and state to context, `App.tsx` becomes **lobby-only**:
- Renders `<NavBar>` + `<Lobby>` only
- Calls `createRoom`/`joinRoom`/`startSolo` from context
- Reacts to context `roomId` changing → `useNavigate()` to `/room/${roomId}`

---

## 4. Active Games — Persistence + Profile Tab

### `ActiveRoom` data model

```ts
interface ActiveRoom {
  roomId: string;
  mode: 'pvp' | 'solo';
  myColor: PlayerColor;
  opponentName: string;
  startedAt: number;   // ms timestamp
  lastSeenAt: number;  // updated on each gameState
}
```

Persisted to `localStorage` as `minesweeper_active_rooms` (JSON array).

### Lifecycle in `GameSessionContext`

- **Add**: on `roomCreated` / `roomJoined` (pvp) or `startSolo()` call
- **Update** `lastSeenAt`: on every `gameState` update
- **Remove**: on `gameOver` or `returnToMenu()`

### Profile tab — "Текущие игры"

Add a tab bar to [`ProfilePage.tsx`](packages/frontend/src/pages/ProfilePage/ProfilePage.tsx):

- Tabs: `[История игр | Текущие игры]`
- "Текущие игры" reads `activeRooms` from `localStorage`
- Each row: opponent name, mode, elapsed time, "→ Продолжить" button → `/room/${roomId}`
- Empty state: "Нет активных игр"
- `ProfilePage` reads `?tab=active` query param to auto-select tab

### Header quick access

In [`ProfileButton.tsx`](packages/frontend/src/components/ProfileButton/ProfileButton.tsx) dropdown:
- New "🎮 Текущие игры" item with badge count when `activeRooms.length > 0`
- Navigates to `/profile/:login?tab=active`
- Avatar button itself shows a small numeric badge overlay when there are active games

---

## 5. Consistent Logo

### [`NavBar.tsx`](packages/frontend/src/components/NavBar/NavBar.tsx)

- Logo icon: `size="2em"` (was `1.6em`) to match game header scale
- Text: "MsPvP" (already correct)
- Always `<Link to="/">` — clicking logo goes to home from any page

`RoomPage` uses this same `NavBar` (with `hideNavLinks={true}`) — the old `renderHeader` H2 in `App.tsx` is removed.

---

## 6. NavBar Links — Left-Aligned, Hidden on Game Page

### Layout change

**Before:**
```
[Logo]          [Правила][Классика]          [⚙️][👤]
  left               center                   right
```

**After:**
```
[Logo][Правила][Классика]                    [⚙️][👤]
   left group                                 right
```

CSS: logo + navLinks in a single `flex-start` flex group. Remove any centering (`margin: auto`).

### `hideNavLinks` prop

```ts
interface NavBarProps {
  auth: AuthApi;
  settings: SettingsApi;
  onHelpOpen?: () => void;
  hideNavLinks?: boolean;  // NEW — hides Правила/Классика links
}
```

- `RoomPage` passes `hideNavLinks={true}`
- All other pages: default `false`

---

## 7. Surrender Button

### Backend — new socket event

[`packages/backend/src/index.ts`](packages/backend/src/index.ts):

```ts
socket.on('surrender', () => {
  const room  = roomManager.getRoom(socket.id);
  const color = roomManager.getPlayerColor(socket.id);
  if (!room || !color) return;
  roomManager.surrender(room, color);
  broadcastGameState(room.id);
});
```

[`packages/backend/src/roomManager.ts`](packages/backend/src/roomManager.ts):

```ts
surrender(room: Room, color: PlayerColor): void {
  const opponent: PlayerColor = color === 'red' ? 'blue' : 'red';
  this.finalizeGameOver(room, opponent, 'surrender');
}
```

[`packages/shared/src/types.ts`](packages/shared/src/types.ts) — add `'surrender'` to `WinReason` union.

For **bot games**: `surrender()` in `GameSessionContext` calls `driver.forfeit()` on the `LocalGameDriver` instance.

### Frontend — `SurrenderButton` component

New: `packages/frontend/src/components/SurrenderButton/SurrenderButton.tsx`

```ts
interface SurrenderButtonProps {
  onSurrender: () => void;
  disabled?: boolean; // true when isFinished
}
```

State machine:
```
idle ──(click)──► pending [3s timer]
                    │
         (click)◄──┤──(timeout)──► idle
            │
       onSurrender()
            │
           idle
```

UI states:
- `idle`: "🏳 Сдаться" — neutral dimmed style
- `pending`: "⚠️ Подтвердите!" — red/warning style + countdown progress bar or shrinking arc

**Visible**: whenever `!isFinished` — **including setup phase** (gives player a quick exit before the game starts). Hidden only when `isFinished`.

### Placement in `RoomPage`

- **Desktop**: left side column, below the primary action button
- **Mobile**: `mobileActionSlot` area, below the board

---

## 8. Bot Engine State — localStorage Serialization

### Problem

`LocalGameDriver` is in-memory only. `GameSessionContext` keeps it alive across navigation, but a **full page refresh** destroys it.

### Solution: snapshot on every commit

In [`LocalGameDriver.ts`](packages/frontend/src/ai/driver/LocalGameDriver.ts), after every `commit()`:

```ts
// key: `minesweeper_solo_state_${soloRoomId}`
localStorage.setItem(
  `minesweeper_solo_state_${this.soloRoomId}`,
  JSON.stringify({
    soloRoomId: this.soloRoomId,
    savedAt: Date.now(),
    humanColor: this.humanColor,
    difficulty: this.difficulty,
    state: cloneState(this.state),
  })
);
```

`LocalGameDriver` constructor gains optional `initialState?: EngineState` — when provided, skips `createInitialState()` and continues from the snapshot.

### Restore flow in `GameSessionContext`

When `startSolo(difficulty, humanColor, soloRoomId)` is called:
1. Check `localStorage.getItem('minesweeper_solo_state_' + soloRoomId)`
2. If found and `savedAt` is < 24h ago → pass `initialState` to driver
3. Otherwise → start fresh

### Cleanup

Delete the snapshot key when `gameOver` fires or `returnToMenu()` is called.

---

## Summary — New Files

| File | Purpose |
|------|---------|
| [`packages/frontend/src/context/GameSessionContext.tsx`](packages/frontend/src/context/GameSessionContext.tsx) | Root provider: socket + local game state, active rooms, solo snapshot restore |
| [`packages/frontend/src/pages/RoomPage/RoomPage.tsx`](packages/frontend/src/pages/RoomPage/RoomPage.tsx) | All game screens: waiting / setup / game / finished |
| [`packages/frontend/src/pages/RoomPage/RoomPage.module.css`](packages/frontend/src/pages/RoomPage/RoomPage.module.css) | Styles for RoomPage |
| [`packages/frontend/src/components/SurrenderButton/SurrenderButton.tsx`](packages/frontend/src/components/SurrenderButton/SurrenderButton.tsx) | Double-click surrender with 3 s timeout state machine |
| [`packages/frontend/src/components/SurrenderButton/SurrenderButton.module.css`](packages/frontend/src/components/SurrenderButton/SurrenderButton.module.css) | Surrender button styles |

---

## Summary — Modified Files

| File | Change |
|------|--------|
| [`packages/backend/src/roomManager.ts`](packages/backend/src/roomManager.ts) | `generateRoomId()` → 16 chars; add `surrender()` |
| [`packages/backend/src/index.ts`](packages/backend/src/index.ts) | Remove `.toUpperCase()` on join; add `surrender` event |
| [`packages/shared/src/types.ts`](packages/shared/src/types.ts) | Add `'surrender'` to `WinReason` |
| [`packages/frontend/src/main.tsx`](packages/frontend/src/main.tsx) | Wrap with `<GameSessionProvider>`; add `/room/:roomId` route |
| [`packages/frontend/src/App.tsx`](packages/frontend/src/App.tsx) | Strip to lobby-only; consume context; navigate to `/room/:id` |
| [`packages/frontend/src/hooks/useSocket.ts`](packages/frontend/src/hooks/useSocket.ts) | Add `surrender()` emit |
| [`packages/frontend/src/ai/driver/LocalGameDriver.ts`](packages/frontend/src/ai/driver/LocalGameDriver.ts) | Accept `initialState?`; serialize on `commit()`; expose `forfeit()` |
| [`packages/frontend/src/components/NavBar/NavBar.tsx`](packages/frontend/src/components/NavBar/NavBar.tsx) | Logo `2em`; links left; `hideNavLinks` prop |
| [`packages/frontend/src/components/NavBar/NavBar.module.css`](packages/frontend/src/components/NavBar/NavBar.module.css) | Flex-start nav group |
| [`packages/frontend/src/components/ProfileButton/ProfileButton.tsx`](packages/frontend/src/components/ProfileButton/ProfileButton.tsx) | "🎮 Текущие игры" dropdown item + badge |
| [`packages/frontend/src/pages/ProfilePage/ProfilePage.tsx`](packages/frontend/src/pages/ProfilePage/ProfilePage.tsx) | "Текущие игры" tab + `?tab=active` param |
| [`packages/frontend/src/pages/ProfilePage/ProfilePage.module.css`](packages/frontend/src/pages/ProfilePage/ProfilePage.module.css) | Tab bar styles |

---

## Implementation Order

1. **Backend**: `generateRoomId()` 16-char; remove `.toUpperCase()`; add `surrender` event + `surrender()` method
2. **Shared types**: add `'surrender'` to `WinReason`
3. **`LocalGameDriver`**: `initialState?` constructor param; serialize on `commit()`; `forfeit()` method
4. **`GameSessionContext`**: lift `useSocket` + `useLocalGame`; add active rooms store; solo snapshot restore; `surrender()` action
5. **`main.tsx`**: `<GameSessionProvider>` wrapper; `/room/:roomId` route
6. **`RoomPage`**: move all game screens from `App.tsx` (waiting / setup / game / finished)
7. **`App.tsx`**: simplify to lobby-only; consume context; navigate on game start
8. **Active rooms**: `ActiveRoom` store wired in context; `ProfilePage` new tab + `?tab=active`
9. **`NavBar`**: logo `2em`; flex-start links; `hideNavLinks` prop
10. **`ProfileButton`**: active games badge + dropdown item
11. **`SurrenderButton`**: component + wire into `RoomPage`
12. **Build check**
