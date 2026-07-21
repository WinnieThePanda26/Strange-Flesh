# Strange Flesh — Community Fork

This is a **fork** of the original Strange Flesh source by Greatest Bear Studios,
upstream at **[UrsaMaximus/Strange-Flesh](https://github.com/UrsaMaximus/Strange-Flesh)**.
All credit for the game itself goes to the original authors; this fork only adds
quality-of-life and polish work on top of their code.

> **Media (images/sounds) are not included** and are unchanged from upstream — you
> still download the official 18+ media pack to run the game. See the
> [Original README](#original-readme) below for the link and the authors' notes.

---

## About this fork

A **quality-of-life and polish revamp** of the existing game — modernization,
usability, and UI cleanup. **No new art assets**, so anything needing new art
(levels, enemies, sprites) is intentionally out of scope. The running backlog
lives in [`ROADMAP.md`](ROADMAP.md), and a deeper architecture guide for
contributors (and AI coding assistants) is in [`CLAUDE.md`](CLAUDE.md).

## Changes in this fork

### Widescreen / variable aspect ratio
- **Variable render width** so the game fills ultrawide/widescreen windows instead
  of letterboxing (dynamic virtual width via `getVirtualScreenWidth()` rather than a
  hardcoded 1920).
- An **"Aspect Ratio" setting** (16:9 / Widescreen) in Settings.
- **Menus, cutscenes, and full-screen UI** stay centered and gap-free at any width.
- The **camera clamps to each level's authored bounds**, so widescreen can't reveal
  past the intended edges of a level.

### Adjustable UI size
- A **"UI Size" setting** (Small / Normal / Large) that scales the previously
  oversized HUD as a single unit, leaving the game world untouched. Bars stay
  anchored to the correct edges in both 16:9 and widescreen.
- The **HUD renders at display resolution**, fixing the nearest-neighbor
  pixelation that appeared when the HUD was shrunk.
- **Menu text and the enemy-info bar** scale with the same setting.

### Combat UI
- **Floating per-enemy health bars:** each regular enemy shows a small, accurate
  health bar above its head that fades in when hit and out a few seconds later, so
  you can track several enemies at once. Bars are segmented for readability. Bosses
  keep the original prominent top-right bar.

### Stability
- Fixed **startup crashes** in both the game and the level editor.

### Developer tooling & docs
- **`serve.py` at the repo root** — a zero-dependency, no-cache dev server, with
  running-from-source instructions (below).
- **[`CLAUDE.md`](CLAUDE.md)** architecture guide and **[`ROADMAP.md`](ROADMAP.md)**
  revamp backlog.
- A **headless "playtest" harness** (`.claude/skills/playtest/`) that boots the game
  in headless Chrome and screenshots a given screen, so visual/UI changes can be
  verified by looking at them.

Contributions in the same spirit (QoL, performance, portability, accessibility)
are welcome — open a pull request.

---

## Original README

_The following is the original project README from Greatest Bear Studios, preserved
here. It contains the media-pack download link and the authors' notes._

Welcome to the Strange Flesh source code repository. Here you can view the full sourcecode of Strange Flesh, and see how we pulled off making a complete, polished game that runs right in a web browser. Everything you need to play the game is here... except images and sounds.

The GitHub community guidelines state:

>Don’t post content that is pornographic. This does not mean that all nudity, or all code and content related to sexuality, is prohibited. We recognize that sexuality is a part of life and non-pornographic sexual content may be a part of your project, or may be presented for educational or artistic purposes.

I don't think we can even try to claim that the sexuality in Strange Flesh qualifies as "part of life" or "non-pornographic". I am not going to insult the intelligence of GitHub's moderation staff.

IF AND ONLY IF YOU ARE OVER 18 YEARS OF AGE, you may download the images and sounds of Strange Flesh from the following off-site link: [Get Strange Flesh Media Pack](http://greatestbear.com/strangeflesh/Strange-Flesh-Media-v1.4.zip)
_Note: This content is highy explicit_

If you would like to contribute to this project by making the game run better on mobile platforms, use less memory, or more easily translatable to other languages, I would love to collaborate. Talk to me. Make a pull request.

-Max
Programmer for Greatest Bear Studios

---

## Running the game from source

The game has no build step, but it **must be served over HTTP** — double-clicking
`index.html` does not work, because browsers block the game's level and asset
requests when loaded from `file://`.

1. Download the media pack (18+ only — link in the [Original README](#original-readme)
   section above) and unzip it into the repo root so that the `images/` and `sound/`
   directories sit next to `index.html`.
2. Start the bundled dev server (Python 3, no dependencies):

   ```bash
   python3 serve.py
   ```

   Any static file server works, but `serve.py` disables caching so code edits
   show up on a plain reload.
3. Open <http://localhost:8000/index.html> and click once if the loading screen
   waits for input (the click unlocks browser audio).

The level editor runs the same way: <http://localhost:8000/editor.html>.

---

## How the codebase works

Strange Flesh is a 2D side-scrolling beat-'em-up that runs entirely in an HTML5 canvas and is
packaged for desktop with Electron. It is plain ES5 JavaScript served as static files — **no
build step, no bundler, no package manager, no framework.** Serve the repo and open
`index.html` (see "Running the game from source" above).

### Entry points
- **`index.html`** loads only `StrangeFlesh.js`, which pulls in every other source file through
  its `include()` helper. The load order is the list of `include()` calls near the top of that
  file; **a new file must be added there**, after its dependencies.
- **`editor.html`** loads `StrangeEdit.js`, the level editor, which reuses the same entity/level
  code with `isEditor = true`.

### The engine (`StrangeFlesh.js`)
Owns the core globals (`camera`, `player`, `level`, `settings`, `controller`, `hud`, the render
canvas `c`/`ctx` and display canvas `displayC`/`displayCtx`) and runs two loops: a fixed-rate
`tick()`/`updateAll()` for all game logic, and a `requestAnimationFrame` `drawAll()` for
rendering. The game draws to a small internal canvas and scales it to the screen; gameplay and
UI coordinates live in a **virtual 1920×1080 space** (use `getVirtualScreenWidth()` rather than
hardcoding `1920`). `menuStack` is a stack of full-screen modal screens (menus/cutscenes) that
take over when present; `overlays` (HUD, etc.) always draw. Save data and settings persist to
`localStorage`.

### Entities, AI, combat, animation
- **Entities** use no inheritance: each is a constructor whose prototype is assembled from shared
  `Entity*` functions in `WalkingEntity.js`, then overrides `UpdateState` (its state machine),
  `animationSetup`, and `DrawSprite`.
- **States** are a flat enum in `EntityStates.js` with predicate helpers (`IsInvulnerable`,
  `IsCaptive`, `IsCorrupt`, …) used throughout combat and AI.
- **AI** lives on `entity.ai`: `AICore.js` runs a queue of action objects; per-enemy `*AI`
  constructors decide which actions to queue.
- **Input** is abstracted by `Controller` (button-state object every entity reads); the player's
  controller is a `PlayerInputController` mapping keyboard + gamepad onto the same interface.
- **Combat** (`Combat.js`) uses `Attack` hitbox/payload objects registered in `activeAttacks`.
- **Animation** (`Animation.js`) is a per-entity `AnimationModel` state machine over sprite sheets.

### Levels
Levels are JSON (`levels/level0.txt`…`level6.txt`) with parallel arrays for entities, background,
foreground, skirmishes, transitions, and collision masks. `Level.js` handles loading,
serialization (`Freeze`/`Thaw`/`GenerateDescriptor`), scroll-triggered spawning, and collision.
Edit them with the level editor (`editor.html`), not by hand.

### Assets
Images and sounds are **gitignored** and shipped separately (see the media-pack link above), so a
clean clone has code but not art — some features can't be fully run without the media pack.

> A more detailed architecture guide for contributors (and AI coding assistants) lives in
> [`CLAUDE.md`](CLAUDE.md).
