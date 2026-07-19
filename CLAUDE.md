# CLAUDE.md

Guidance for working in the Strange Flesh codebase. This file is loaded into context
automatically each session — keep it accurate when the architecture changes.

## What this is

Strange Flesh is a complete 2D side-scrolling beat-'em-up that runs in a browser canvas
and is packaged for desktop with Electron. It's an adult game by Greatest Bear Studios.
The repo holds all the JavaScript source; image and sound assets are **gitignored** (see
`.gitignore`) and distributed separately — so the game cannot fully run from a clean clone
without the media pack referenced in `README.md`.

There is no build step, no bundler, no package manager, and no framework. It is plain ES5
("var", function constructors, prototypes) served as static files. Do not introduce a build
system or rewrite to modules unless explicitly asked.

## Running it

- The game must be **served over HTTP** (file:// fails — browsers block its level/asset
  requests): `python3 serve.py` in the repo root serves it no-cache on :8000, then open
  `http://localhost:8000/index.html` (or `/editor.html`). The playtest skill uses this
  same server headlessly.
- **`index.html`** → the game. Loads only `StrangeFlesh.js`, which then pulls in every other
  file via the `include()` helper (dynamic `<script>` injection). The full load order lives in
  `StrangeFlesh.js` right after the `include` definition — **if you add a new file, you must add
  an `include()` line there**, ordered after its dependencies.
- **`editor.html`** → the level editor. Loads `StrangeEdit.js` (a parallel entry point that
  reuses most of the same entity/level code with `isEditor = true`).
- Electron integration is guarded by a `typeof(process)` check at the top of `StrangeFlesh.js`;
  `BrowserWindow`/`app` are only set under Electron and used for window sizing/fullscreen.

## Core architecture (StrangeFlesh.js)

`StrangeFlesh.js` is the engine entry point and owns all the important globals: `c`/`ctx`
(internal render canvas + context), `displayC`/`displayCtx` (the on-screen canvas), `camera`,
`player`, `level`, `overlays`, `menuStack`, `settings`, `controller`, `hud`.

Two independent loops:
- **`tick()` → `updateAll()`** runs on a `setInterval` at `fps` (default 60). All game logic
  lives here: entity updates, attacks, effects, level update, camera, input polling, player
  respawn/death handling. Gated by `GlobalResourceLoader.AllReady()`.
- **`drawAll()`** runs on `requestAnimationFrame`. Renders background → entities (depth-sorted)
  → foreground → debug → overlays, then `blitInternalBuffer()` copies the internal `c` canvas to
  the display canvas. An `updated` flag throttles draw to one frame per update.

**Rendering model:** the game renders to a small internal canvas (`nativeRenderWidth`×
`nativeRenderHeight`, 640×360) and scales it up to the display. Gameplay/UI coordinates are
expressed in a **1920×1080 virtual space**; code multiplies by `ratioTo1080p` (`c.height/1080`)
to map into the render canvas. `getVirtualScreenWidth()` returns the current virtual width
(1920 at 16:9, wider in widescreen mode). **Never hardcode 1920** for full-width fills or
right-edge anchoring — use `getVirtualScreenWidth()`. `resizeCanvas()` handles window resizing,
DPI/retina, render-quality snapping, and low-framerate fallback scaling.

**State / screen flow:** `menuStack` is a stack of full-screen modal screens (menus, cutscenes,
transitions, game-over). When non-empty, the top item's `Update()`/`Draw()` take over and normal
gameplay is suspended. `overlays` is a separate always-drawn list (HUD, EnemyInfo, DebugOverlay,
GlobalLight). Game start flow: `StrangeFlesh()` → title card → `resetGame()` → load `level0` →
opening cutscene → `MainMenu`.

**Save/settings:** `saveGame()`/`loadGame()` serialize to `localStorage["SavedGame"]` (player
state + per-level descriptors). `saveSettings()`/`loadSettings()` use `localStorage["GameSettings"]`;
`settings` defaults are defined inline in `loadSettings()` and only known keys are merged from
storage. Debug keys (toggle with `B`, then F/G/H/T/Y/P/etc.) are wired in `keyDown()` and only
active when debug is unlocked.

## Entities

There is **no class inheritance**. Entities are constructor functions whose prototypes are
assembled from shared free functions defined in `WalkingEntity.js` (named `EntityInit`,
`EntityUpdate`, `EntityHit`, `EntityDraw`, `EntityChangeState`, `EntityCollisionDetection`,
`EntityCapture`, etc.). A typical enemy file ends with a block like:

```js
OfficeAngel.prototype.Init    = EntityInit;
OfficeAngel.prototype.Update  = EntityUpdate;
OfficeAngel.prototype.Hit     = EntityHit;
// ...assign each shared behavior, then override the ones that differ:
OfficeAngel.prototype.UpdateState     = function() { /* per-entity state machine */ };
OfficeAngel.prototype.animationSetup  = function() { /* register animation states */ };
OfficeAngel.prototype.DrawSprite      = function() { /* ... */ };
```

To create/modify an entity: copy this assignment pattern, then override `UpdateState`,
`animationSetup`, `DrawSprite`, and combat tuning. The big per-entity state machine lives in
each entity's `UpdateState` and switches on `this.state` (values from `States` in
`EntityStates.js`).

**States** (`EntityStates.js`): `States` is a flat enum of ~60 states (Walk, Run, BasicAttack,
Grab, Captive, Corrupt, SmokeKiss, etc.). Helper predicates — `IsInvulnerable`, `IsAttackable`,
`IsCaptive`, `IsCorrupt`, `IsPassthrough`, `IsKnockedBack`, `IsCapableOfThought` — classify a
state and are used pervasively in combat and AI. When adding a state, also update the relevant
predicates or behavior will be subtly wrong.

**AI** (`AICore.js` + `BasicAIController.js` + per-enemy `*AI` constructors): AI is a separate
object on `entity.ai`. `AICore` runs a queue of *action* objects (`FollowTargetAction`,
`ChaseAttackAction`, `FleeAction`, `GoToPointAction`, `AttackTargetAction`, `WaitAction`, …),
each with `Update()`/`Complete()`. Per-enemy AI files (e.g. `OfficeAngelAI`, `BottleyAI`,
boss phases in `Joe5.js`) decide which actions to queue. `entity.ai = null` makes an entity
inert / player-controlled. `ai.Flush()` cancels current actions (used on freeze, capture, death).

**Input** (`Controller.js` / `PlayerInputController.js`): `Controller` is the abstract button
state object every entity reads (`controller.left`, `.punch`, `.jump`, `startActivate()`, …).
AI entities own a plain `Controller` the AI drives; the human player's entity points
`this.controller` at the global `controller`, a `PlayerInputController` that maps keyboard +
gamepad (via `GamepadButtonMonitor`) to the same interface. Keybinds live in `settings` and are
applied in `loadSettings()`/`saveSettings()`.

**Combat** (`Combat.js`): `Attack` objects describe a hitbox + damage payload (`damageDealt`,
`corruptionDealt`, `staminaDrained`, `hitStunDealt`, `intoxicationDealt`, alliance). Live attacks
are registered in the global `activeAttacks` array, updated each frame, and call `EntityHit` on
entities they overlap. Entities have `health`, `stamina`, `sexMeter`, and an `alliance`
(0 = neutral, 1 = player side, 2 = enemy). The game's hook is "corruption": enemies are defeated
either by knockout (domination) or by being corrupted/seduced (the sex mechanics), tracked via
`enemiesDispatched` / `enemiesCorrupted` / `totalEnemies`.

**Animation** (`Animation.js`): `AnimationModel` (one per entity, `this.animationModel`) is a
state machine of named `AnimationState`s built from sprite sheets. Entities register states in
`animationSetup()` and switch with the model's `ChangeState`. Supports decorator layers,
duration-in-seconds vs frames, and transition/activation frame queries used to sync gameplay
events (e.g. "spawn the hitbox on the frame the punch lands").

## Levels

Levels are JSON in `levels/level0.txt`…`level6.txt` (plus `staircase_test.txt`). A level
descriptor holds metadata (`musicTrack`, `displayName`, `spawnPosition`, `gameOverScreen`) plus
parallel arrays: `entities`, `effects`, `foreground`, `background`, `skirmishes`, `transitions`,
`collisionMask`, `cameraMask`. Each object is serialized by `descriptorObjectType` (its
constructor name) + its whitelisted editor/runtime properties.

`Level.js` handles load/serialize/lifecycle:
- **Loading**: `LoadFromLevelDescriptor` reconstructs objects via `GenerateObjectFromSubDescriptor`,
  which does `stringToFunction(descriptorObjectType)` then copies only properties listed in each
  object's `editorProperties`/`runtimeProperties` (see `isEditorProperty`). New serializable
  fields on an entity must be added to those arrays or they won't persist.
- **Lifecycle**: `Start()` spawns the player, captures enemies into skirmish boxes, and queues
  off-screen entities for scroll-triggered spawning (`entitiesToSpawn`, sorted by X).
  `Freeze()`/`Thaw()` snapshot a level when leaving/returning so progress persists across level
  changes; `GenerateDescriptor()` is the inverse of load and is what save games store.
- **Collision**: `collisionMask` (world) and `cameraMask` (camera limits) are `LevelCollisionMask`
  line sets; `Collide()`/`PlaceWithCollision()` do continuous collision resolution.
- **Skirmishes** (`SkirmishBox.js`): trigger regions that lock the player in and gate progress
  until all contained enemies are defeated. **Transitions** (`TransitionBox.js`) move the player
  between levels.

The level editor (`StrangeEdit.js`, `editor.html`) reads/writes this same format and is the
intended tool for level changes — hand-editing the JSON is possible but fragile.

## Conventions & gotchas

- **ES5 only**, `var`, prototype assignment, function-constructor "classes". Match the
  surrounding style; semicolons after function-expression assignments are normal here.
- **Coordinates are virtual 1920×1080**; map with `ratioTo1080p`/`getVirtualScreenWidth()`,
  never raw pixels of the render canvas.
- **Adding a file** requires an `include()` line in `StrangeFlesh.js` (and likely the editor).
- **Adding a serialized entity property** requires updating that entity's
  `editorProperties`/`runtimeProperties`.
- Globals are genuinely global (no modules); `ResourceLoader.js` creates `GlobalResourceLoader`
  and `Music.js` creates `GlobalMusic`. Many files depend on load order.
- Assets are absent from the repo; features touching new art/sound can't be fully verified
  without the media pack.

## Current in-progress work

Recent uncommitted/branch work has been **modernization**, not new content: Electron 18 upgrade,
gamepad support fixes, and a **variable / widescreen aspect-ratio** feature (dynamic render
width via `getVirtualScreenWidth()`, a "widescreen" settings toggle, and replacing hardcoded
`1920` references across HUD/overlays). When touching rendering or HUD layout, preserve the
"use the dynamic virtual width" rule above.
