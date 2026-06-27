---
name: playtest
description: Run Strange Flesh in a headless browser and screenshot a screen (main menu, settings, controls; 16:9 or widescreen) so visual/UI changes can be verified by looking at them. Use when asked to run the game, see how a UI change looks, or verify a visual change to menus/HUD/aspect ratio.
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

1. **Start the no-cache server** (serves the repo root on :8000) if it isn't up:

   ```bash
   curl -sf -o /dev/null http://localhost:8000/index.html \
     || python3 .claude/skills/playtest/serve.py &
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

- `--state mainmenu | settings | controls | none`  (default `mainmenu`)
- `--widescreen`  enable widescreen aspect (otherwise 16:9)
- `--width N --height N`  viewport size (default 2560x1080; use a wide ratio to
  exercise widescreen, e.g. 2560x1080 ≈ 21:9)
- `--keys Enter,ArrowDown,...`  press keys after reaching the screen (drive menus)
- `--shot PATH`  output PNG (default `/tmp/sf-playtest/shot.png`)
- `--wait MS`  settle time before the screenshot (default 1000)

## Gotchas / how it works

- The loader hard-gates `AllReady` behind a WebAudio unlock (`ResourceLoader.js`
  sets `this.iOS = true`); the harness auto-clicks and clears the lock so the game
  proceeds past "Tap to Start".
- Menus render in a 640-wide space centered via `getMenuOffsetX()`; the script
  logs `cW`/`menuOffsetX` so you can confirm the math (0 at 16:9, >0 widescreen).
- It forces menu state directly (`new MainMenu()`, `ShowSettingsMenu`) rather than
  navigating the title/cutscene flow, which would need scripted key presses.
- Headless rendering ≈ real but not identical (no gamepad, audio muted). It
  verifies appearance, not game feel — the user still playtests for that.
- Driving real gameplay (inside a level) isn't wired up yet; this covers menus,
  HUD overlays, and aspect-ratio behavior.
