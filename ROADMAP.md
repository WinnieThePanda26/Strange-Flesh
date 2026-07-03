# Strange Flesh — Revamp Roadmap

The backlog / source of truth for the revamp. This pass is a **quality-of-life and
polish revamp** of the existing game — modernization, usability, and UI cleanup.
**No new art assets yet**, so anything that needs new art (new levels, new enemies,
new sprites) is parked under "Later".

Status: `[ ]` todo · `[~]` in progress · `[x]` done · `[?]` needs a decision

---

## Now — in progress

### Widescreen support
- [x] Variable / widescreen aspect ratio (dynamic render width, `getVirtualScreenWidth()`)
- [x] "Aspect Ratio" setting (16:9 / Widescreen) in Settings
- [x] Center menus & cutscenes in widescreen (menu offset + `sstext.offsetX`)
- [ ] **Verify in browser** — confirm menus center and HUD anchors correctly at
      ultrawide; the menu-centering fix is committed but not yet visually confirmed
- [ ] Sanity-check gameplay edges in widescreen (enemy spawn timing, camera limits,
      light/overlay fills using `getVirtualScreenWidth()`)

_Branch: `widescreen-aspect-ratio`_

---

## Next — UI & QoL (no new art needed)

### Shrink the HUD / oversized UI
The health, sex, corruption, and domination bars are drawn at a hardcoded **3×**
(`pxScale = 3.0` + `DrawSprite3x` in `HUD.js`). They dominate the screen at 1080p.
- [x] Introduce a dedicated HUD scale (`getHudScale()`) that multiplies the HUD's
      base 3× layout via the ctx transform — the whole HUD scales as one unit,
      leaving the global `pxScale` (game world) untouched
- [x] Re-anchor bars after scaling using a scaled `designWidth` so corruption/
      domination stay pinned to the right edge in both 16:9 and widescreen
- [x] Expose a "HUD Size" setting (Small 0.6 / Normal 0.8 / Large 1.0); default
      Normal is 20% smaller than the old size, Large restores the original
- [ ] Check EnemyInfo (boss/enemy nameplate) sizing for the same issue

### Difficulty settings (net-new — none exist today)
- [ ] [?] Define what difficulty changes: enemy damage taken/dealt, player health,
      starting lives, enemy aggression — pick the levers
- [ ] Add a `difficulty` setting + default in `loadSettings()` and a Settings entry
- [ ] Apply multipliers at the combat layer (`Combat.js` / `EntityHit` in
      `WalkingEntity.js`) and/or lives in `StrangeFlesh.js`
- [ ] Persist + verify it survives save/load

### General QoL bucket (collect small wins here)
- [ ] _(add items as they come up)_

---

## Later — needs new art or bigger design

- [ ] New levels (requires new background/prop/tile art — art-gated)
- [ ] New enemies / content (requires sprite sheets — art-gated)

---

## How we work
- One branch per theme; rebase onto `master` to stay current.
- Use **plan mode** for anything that spans multiple files (e.g. difficulty, HUD
  rescale) — design first, then implement.
- Architecture reference lives in `CLAUDE.md` (gitignored, local).
- Verify gameplay/UI changes by running the game in the browser, not just by reading.
