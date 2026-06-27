# Strange Flesh Source

Welcome the the Strange Flesh source code repository. Here you can view the full sourcecode of Strange Flesh, and see how we pulled off making a complete, polished game that runs right in a web browser. Everything you need to play the game is here... except images and sounds.

The GitHub community guidelines state:

>Don’t post content that is pornographic. This does not mean that all nudity, or all code and content related to sexuality, is prohibited. We recognize that sexuality is a part of life and non-pornographic sexual content may be a part of your project, or may be presented for educational or artistic purposes.

I don't think we can even try to claim that the sexuality in Strange Flesh qualifies as "part of life" or "non-pornographic". I am not going to insult the intelligence of GitHub's moderation staff. 

IF AND ONLY IF YOU ARE OVER 18 YEARS OF AGE, you may download the images and sounds of Strange Flesh from the following off-site link: [Get Strange Flesh Media Pack](http://greatestbear.com/strangeflesh/Strange-Flesh-Media-v1.4.zip)
_Note: This content is highy explicit_

If you would like to contribute to this project by making the game run better on mobile platforms, use less memory, or more easily translatable to other languages, I would love to collaborate. Talk to me. Make a pull request.

-Max
Programmer for Greatest Bear Studios

---

## How the codebase works

Strange Flesh is a 2D side-scrolling beat-'em-up that runs entirely in an HTML5 canvas and is
packaged for desktop with Electron. It is plain ES5 JavaScript served as static files — **no
build step, no bundler, no package manager, no framework.** Just open `index.html`.

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
