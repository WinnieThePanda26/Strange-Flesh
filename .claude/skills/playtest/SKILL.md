---
name: playtest
description: Run Strange Flesh in a headless browser and screenshot a screen (main menu, settings, controls, in-game HUD; 16:9 or widescreen) so visual/UI changes can be verified by looking at them. Use when asked to run the game, see how a UI change looks, or verify a visual change to menus/HUD/aspect ratio.
---

# Playtest harness

Drives the game in headless Chrome (via `puppeteer-core` + the user's installed
Chrome), reaches a given screen, and writes a PNG to look at. This is how to
*see* a change, not just reason about it.

All paths below are relative to the repo root. Run commands from the repo root.

## One-time setup (per machine)

Dependencies live next to the skill and are gitignored. If `node_modules` is
missing, install it:

```bash
[ -d .claude/skills/playtest/node_modules ] || npm --prefix .claude/skills/playtest install
```

Chrome is expected at `/Applications/Google Chrome.app/...`. Override with the
`CHROME_PATH` env var if needed.

## Running

1. **Start the no-cache server** (`serve.py` in the repo root, serves on :8000)
   if it isn't up:

   ```bash
   curl -sf -o /dev/null http://localhost:8000/index.html \
     || python3 serve.py &
   ```

   No-cache means edits show up on reload — important so screenshots reflect the
   current working tree.

2. **Capture a screen**:

   ```bash
   node .claude/skills/playtest/playtest.js --state mainmenu --widescreen \
     --shot /tmp/sf-playtest/mainmenu_wide.png
   ```

3. **Read the PNG** with the Read tool to see the result.

### Options

- `--state mainmenu | settings | controls | game | none`  (default `mainmenu`)
- `--widescreen`  enable widescreen aspect (otherwise 16:9)
- `--width N --height N`  viewport size (default 2560x1080; use a wide ratio to
  exercise widescreen, e.g. 2560x1080 ≈ 21:9)
- `--hudsize 0|1|2`  HUD Size setting for `--state game` (0 small, 1 normal, 2 large)
- `--keys Enter,w,s,...`  press keys after reaching the screen (drive menus).
  Keys are held ~90ms each; menus poll the *bound* keys, so use `w`/`s` (not
  arrow keys) for up/down and `Enter` for select/pause.
- `--eval "JS"`  evaluate an expression in the page after reaching the state
  (e.g. `--eval "(function(){ var g=new GameOver(); g.Show(); })()"` to force
  a screen the states don't cover); the result is logged as `EVAL:`.
- `--shot PATH`  output PNG (default `/tmp/sf-playtest/shot.png`)
- `--wait MS`  settle time before the screenshot (default 1000)

`--state game` runs `resetGame()`, then jumps to level1 (the HUD hides itself on
level0) and pins the HUD bars/lives to representative values every frame so they
are visible and deterministic (they otherwise fade in / crawl over minutes).
Example — widescreen HUD at small size, then pause menu over gameplay:

```bash
node .claude/skills/playtest/playtest.js --state game --widescreen --hudsize 0 \
  --shot /tmp/sf-playtest/hud_small.png
node .claude/skills/playtest/playtest.js --state game --widescreen --keys Enter \
  --wait 2500 --shot /tmp/sf-playtest/pause.png
```

The editor can be smoke-tested too: `--url http://localhost:8000/editor.html
--state none` (watch for `PAGEERROR:` lines).

## Gotchas / how it works

- The loader hard-gates `AllReady` behind a WebAudio unlock (`ResourceLoader.js`
  sets `this.iOS = true`); the harness auto-clicks and clears the lock so the game
  proceeds past "Tap to Start".
- Menus render in a 640-wide space centered via `getMenuOffsetX()`; the script
  logs `cW`/`menuOffsetX` so you can confirm the math (0 at 16:9, >0 widescreen).
- It forces menu state directly (`new MainMenu()`, `ShowSettingsMenu`) rather than
  navigating the title/cutscene flow, which would need scripted key presses.
- The script sleeps 600ms after forcing a state before sending keys: menus ignore
  input for their first ~20 frames, and pausing before a frame has rendered would
  capture the loading screen as the pause-menu background.
- Menus forced from a cold start have a black/transparent screencap background;
  judge the pause-menu backdrop from `--state game --keys Enter`, not from the
  forced `settings` state (its title-stripe area may look wrong — artifact only).
- The settings/pause menus *scroll*: items past the bottom edge are normal in a
  static screenshot; verify reachability by navigating with `--keys`.
- Headless rendering ≈ real but not identical (no gamepad, audio muted). It
  verifies appearance, not game feel — the user still playtests for that.
