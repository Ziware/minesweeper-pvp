# Home UX Redesign + New Pages Plan

## Overview

The current lobby is a compact, functional form focused on power users who already know what they want. The redesign makes the home page serve both newcomers (clear mode descriptions, hero tagline) and experienced players (fast access to same controls). Two new standalone pages are added: a rules page and a classic minesweeper mode.

---

## New Site Structure

```
/           — Home/Landing (redesigned Lobby)
/rules      — Full rules page (shareable link)
/classic    — Classic vanilla Minesweeper
/profile/:login — Profile (existing)
```

The game itself launches from the home page — the App routing stays at `/*`, but the lobby component becomes the landing page.

---

## Architecture Diagram

```mermaid
graph TD
    Home[/ — Home Page] -->|Click PvP card| GameSetup[PvP Setup — inline expanded]
    Home -->|Click Bot card| BotSetup[Bot Setup — inline expanded]
    Home -->|Click Classic card| ClassicPage[/classic]
    Home -->|Nav link| RulesPage[/rules]
    Home -->|Nav link| ProfilePage[/profile/:login]
    GameSetup -->|Create Room| App[App — waiting/game screens]
    BotSetup -->|Start Game| App
    RulesPage -->|Back| Home
    ClassicPage -->|Back| Home
```

---

## Part 1 — Home Page Redesign

### Visual Layout

```
┌──────────────────────────────────────────────────────┐
│ NavBar: [💣 MsPvP]  [Rules]  [Classic]  [ProfileBtn] │
├──────────────────────────────────────────────────────┤
│                                                      │
│          💣 Minesweeper PvP                          │
│     Тактическая дуэль на минном поле                 │
│  Два игрока. Одна доска. Мины противника скрыты.     │
│  Захвати штаб врага — и победишь.                    │
│                                                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐     │
│  │ 👥 PvP     │  │ 🤖 vs Bot  │  │ 💣 Classic  │    │
│  │ Онлайн     │  │ Оффлайн    │  │ Классика    │    │
│  │ [desc 2-3] │  │ [desc 2-3] │  │ [desc 2-3] │    │
│  │ строки]    │  │ строки]    │  │ строки]    │    │
│  │            │  │            │  │            │    │
│  │ [Играть]   │  │ [Играть]   │  │ [Открыть]  │    │
│  └────────────┘  └────────────┘  └────────────┘     │
│                                                      │
│  ▼ Expanded inline when PvP / Bot selected:          │
│  ┌────────────────────────────────────────────────┐  │
│  │ Имя: [_______]  Время: [⚡3+2] [🐢5+0] ...    │  │
│  │ [Создать комнату]     [Войти: _____ →]         │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### Mode Card Content

| Card | Icon | Title | Description |
|------|------|-------|-------------|
| PvP | 👥 | Против игрока | Онлайн-дуэль с живым противником. Создай комнату и поделись кодом или введи код друга. |
| vs Bot | 🤖 | Против компьютера | Тренируйся оффлайн против ИИ трёх уровней сложности — без регистрации. |
| Classic | 💣 | Классический сапёр | Стандартный Сапёр на скорость. Пресеты новичок/любитель/эксперт или своё поле. |

### UX Behavior

- **Default state**: three cards side-by-side, no expanded area
- **Click PvP / Bot card**: card gets an `active` highlight, an expanded setup panel slides in below the cards (name input + game-specific options + action buttons)
- **Click active card again**: collapses back
- **Classic card**: navigates to `/classic` via React Router `<Link>`
- Cards stack vertically on mobile, expanded panel appears below the active card

### Changes to Existing Files

- [`Lobby.tsx`](packages/frontend/src/components/Lobby/Lobby.tsx) — full rewrite with new card-based layout
- [`Lobby.module.css`](packages/frontend/src/components/Lobby/Lobby.module.css) — new styles (mode cards, hero section, expanded panel)

---

## Part 2 — Shared NavBar Component

### Purpose

Currently both `App.tsx` and `ProfilePage.tsx` implement their own header with a `renderHeader()` helper. A shared `NavBar` component eliminates duplication and provides consistent top navigation across lobby and standalone pages.

### Visibility Rule

**NavBar is shown only on the lobby (home) and standalone pages** (`/rules`, `/classic`, `/profile/:login`). During an active PvP or solo game, `App.tsx` continues to use its own game-specific header (which shows room controls, timer, return-to-menu button). This keeps the game experience clean and undisturbed.

### NavBar Content

```
Left:  [💣 MsPvP logo — links to /]
Center: (empty on mobile, nav links on desktop)
Right: [Rules]  [Classic]  [⚙️ Settings]  [ProfileButton]
```

On mobile: only logo + profile button visible; nav links are hidden (rules/classic accessible from home cards instead).

### New Files

- `packages/frontend/src/components/NavBar/NavBar.tsx`
- `packages/frontend/src/components/NavBar/NavBar.module.css`

### Modified Files

- `packages/frontend/src/App.tsx` — use `<NavBar>` on the lobby screen only; game screens keep existing `renderHeader()`
- `packages/frontend/src/pages/ProfilePage/ProfilePage.tsx` — use `<NavBar>` instead of local header
- `packages/frontend/src/App.module.css` — header styles remain but lobby-screen header can be replaced

### NavBar Props

```ts
interface NavBarProps {
  auth: AuthApi;
  settings: SettingsApi;
  onHelpOpen?: () => void; // for pages that want the help button
}
```

---

## Part 3 — Rules Page (`/rules`)

### Purpose

Dedicated full-page version of the PvP game rules. Makes rules shareable via direct link and usable outside the game. **[`HelpModal.tsx`](packages/frontend/src/components/HelpModal/HelpModal.tsx) is kept as-is** — it remains the quick in-game overlay accessible during a match and is not modified.

### Content Sections

1. **Цель игры** — capture enemy HQ
2. **Поле** — board size, mine placement, ownership
3. **Ход игрока** — Phase 1 (zone selection), Phase 2 (capture), Phase 3 (extra mines)
4. **Дефюзеры** — how they're granted and used
5. **Контроль времени** — presets, time-per-move
6. **Победа и поражение** — win conditions

Content is written directly in `RulesPage.tsx` — same information as `HelpModal` but formatted for a full scrollable page (no need to extract a shared component since `HelpModal` stays unchanged).

### UX

- Same dark theme as the rest of the app
- Uses `<NavBar>` at top
- `← На главную` back link
- Content rendered as styled `<article>` with section headers
- Fully scrollable, no overlay

### New Files

- `packages/frontend/src/pages/RulesPage/RulesPage.tsx`
- `packages/frontend/src/pages/RulesPage/RulesPage.module.css`

---

## Part 4 — Classic Minesweeper Page (`/classic`)

### Visual Design

Same dark-blue theme and board aesthetics as PvP. The player's perspective:
- **Player = Blue** (opened cells shown in blue tones like captured cells)
- **Unrevealed cells** = red/dark tone (like enemy territory)
- **Mines on game-over** = revealed with mine icon
- **Flags** = same flag icon as PvP board
- **First-click safety**: board is generated after the first click, guaranteeing the clicked cell and its neighbors are mine-free

```
┌──────────────────────────────────────────────────┐
│ NavBar                                           │
├──────────────────────────────────────────────────┤
│ Классический Сапёр                               │
│                                                  │
│ [🟢 Новичок] [🟡 Любитель] [🔴 Эксперт] [⚙ Своё] │
│ (Custom: Width × Height  Mines: N)               │
│                                                  │
│ ⏱ 00:00    💣 осталось: N    [🔄 Рестарт]        │
│                                                  │
│ ┌─────────────────────┐                          │
│ │   Classic Board     │                          │
│ │   (cells grid)      │                          │
│ └─────────────────────┘                          │
│                                                  │
│ 🏆 Лучшее время: Новичок: 45s  Любитель: —       │
└──────────────────────────────────────────────────┘
```

### Presets

| Preset | Grid | Mines |
|--------|------|-------|
| Новичок | 9×9 | 10 |
| Любитель | 16×16 | 40 |
| Эксперт | 30×16 | 99 |
| Своё | 8–30 × 8–24 | 1–(w×h/3) |

### Game Logic — `useClassicGame` Hook

State managed entirely client-side:

```ts
interface ClassicCell {
  hasMine: boolean;
  revealed: boolean;
  flagged: boolean;
  adjacentMines: number;
}

type ClassicStatus = 'idle' | 'playing' | 'won' | 'lost';
```

Logic:
- **Board generation** on first click (guarantees safe zone for clicked cell + 8 neighbors)
- **Reveal** — recursive flood-fill for cells with 0 adjacent mines
- **Flag toggle** — right-click or long-press (mobile)
- **Chord** — click on a revealed number cell when correct number of flags are adjacent
- **Timer** — starts on first click, stops on win/loss
- **Win condition** — all non-mine cells revealed
- **Best time** — saved to `localStorage` per preset key

### Components — `ClassicBoard.tsx`

**Fully derived from [`Board.tsx`](packages/frontend/src/components/Board/Board.tsx)** — `Board.tsx` + `Board.module.css` are copied as the starting point, then adapted:

- **All visual effects are preserved**: mine explosion animation, cell reveal animations, chord preview highlighting, mark icons
- **All sounds are preserved**: explosion, flag, victory, defeat — wired via the same [`useSound`](packages/frontend/src/hooks/useSound.ts) hook
- **PvP-specific concepts are stripped**: zone selection (3×3/5×5 highlight), cell ownership coloring (red/blue player sides), headquarters logic, phase 1/2/3 state
- **Classic-specific adaptations**: variable grid width driven by board columns; cell states mapped to classic semantics (`unrevealed` → red/dark, `revealed` → blue/light, `mine-hit` → explosion, `flagged` → flag icon)
- **First-click hint**: subtle glow/pulse on center region cells before the first move to guide new players to a safe starting area
- Props: `cells[][]`, `status`, `onReveal(r, c)`, `onFlag(r, c)`, `onChord(r, c)`, `firstClickHint?: boolean`

### New Files

- `packages/frontend/src/pages/ClassicPage/ClassicPage.tsx`
- `packages/frontend/src/pages/ClassicPage/ClassicPage.module.css`
- `packages/frontend/src/hooks/useClassicGame.ts`
- `packages/frontend/src/components/ClassicBoard/ClassicBoard.tsx`
- `packages/frontend/src/components/ClassicBoard/ClassicBoard.module.css`

---

## Part 5 — Routing Updates

### [`main.tsx`](packages/frontend/src/main.tsx) Changes

```tsx
<Routes>
  <Route path="/profile/:login" element={<ProfilePage />} />
  <Route path="/rules" element={<RulesPage />} />
  <Route path="/classic" element={<ClassicPage />} />
  <Route path="/*" element={<App />} />
</Routes>
```

---

## Summary — New Files

| File | Purpose |
|------|---------|
| `src/components/NavBar/NavBar.tsx` | Shared header nav for lobby + standalone pages |
| `src/components/NavBar/NavBar.module.css` | NavBar styles |
| `src/pages/RulesPage/RulesPage.tsx` | `/rules` full-page rules |
| `src/pages/RulesPage/RulesPage.module.css` | Rules page layout |
| `src/pages/ClassicPage/ClassicPage.tsx` | `/classic` route |
| `src/pages/ClassicPage/ClassicPage.module.css` | Classic page layout |
| `src/hooks/useClassicGame.ts` | Classic game logic hook |
| `src/components/ClassicBoard/ClassicBoard.tsx` | Classic board renderer (derived from Board.tsx) |
| `src/components/ClassicBoard/ClassicBoard.module.css` | Classic board styles (derived from Board.module.css) |

## Summary — Modified Files

| File | Change |
|------|--------|
| `src/main.tsx` | Add `/rules`, `/classic` routes |
| `src/App.tsx` | Use `<NavBar>` on lobby screen; game screens unchanged |
| `src/pages/ProfilePage/ProfilePage.tsx` | Use `<NavBar>` instead of local header |
| `src/components/Lobby/Lobby.tsx` | Full rewrite — hero + mode cards + inline expand |
| `src/components/Lobby/Lobby.module.css` | New card-based styles |

## Decisions Made

| # | Decision |
|---|----------|
| 1 | **NavBar during game**: NOT shown during active PvP/solo — only on lobby and standalone pages |
| 2 | **HelpModal**: Kept as-is as quick in-game overlay; not modified |
| 3 | **ClassicBoard**: Separate component, derived from Board.tsx with all visual/sound effects preserved |
| 4 | **Inline expand**: PvP/Bot setup expands inline below the mode cards (not a separate screen) |
