# Strange Flesh tests

Automated tests for the game. They run the real game in headless Chrome, step it
frame by frame with a fixed random seed, and check what happens.

```bash
node tests/run.js
```

About 40 seconds. Exit code 0 when nothing failed.

## What you need

- **The media pack** (`images/`, `sound/`). Animation timing comes from the sprite
  sheets, so the tests cannot run from a bare clone.
- **Node** and **Google Chrome**. Set `CHROME_PATH` if Chrome is not in `/Applications`.
- **puppeteer-core**, shared with the playtest skill. One-time install:

  ```bash
  npm --prefix .claude/skills/playtest install
  ```

The runner serves the repo itself on a spare port; you do not need `serve.py` running.
Each run uses a throwaway Chrome profile, so your own saves and settings are never touched.

## Options

| Command | What it does |
|---|---|
| `node tests/run.js --filter grab` | Only tests whose name or file contains "grab" |
| `node tests/run.js --seed 7` | Run with a different random seed (default 1) |
| `node tests/run.js -v` | Also print each passing test's notes |
| `node tests/run.js --isolate` | Fresh page for every test (default: one page per file) |
| `node tests/run.js --list` | List the tests |
| `node tests/run.js --filter replay --update` | Re-baseline the recordings to current behaviour |
| `node tests/run.js --record NAME --level level1` | Record yourself playing (see below) |
| `node tests/run.js --watch NAME` | Watch a recording play back in a window |
| `node tests/run.js --watch-bot level1` | Watch the bot play a level in a window |

When a test fails, a screenshot and a dump of the game state are written to
`tests/out/<test name>/` (gitignored).

## What is covered

| File | Tests |
|---|---|
| `01-determinism.js` | Same seed + same input = same game, in separate page loads; a new game in a used page is a clean slate |
| `02-level-smoke.js` | Levels 0–6 each load and run 600 frames with no errors or NaN positions |
| `03-enemy-ai.js` | Each of the 14 hostile enemy types attacks an idle player; Joe0 stays a pacifist; OfficeAngel flees an Admonitor |
| `04-grab.js` | Grab, carry and release |
| `05-defeat.js` | Knockout gives domination orbs only; corruption gives corruption orbs only; meters move when the orbs land; a HUD reset drops orbs still in flight |
| `06-joe5-phases.js` | The level 5 boss changes AI phase 0→4 on the right triggers |
| `07-save-load.js` | Save, wipe, load: lives, poppers, health, meters, position and every entity come back |
| `08-transitions.js` | Level 0 → 1; level 1 → 2 → 1 returns to the level as it was left |
| `09-bot.js` | A bot plays level 0 and level 1 from spawn to exit |
| `10-replay.js` | Every recording in `tests/recordings/` still plays out exactly as recorded |
| `11-known-issues.js` | Problems in the game that the tests document (see "Known issues") |
| `12-arcade.js` | Arcade mode: wave 1 comes in from off-screen and wave 2 waits for it to be cleared; knockouts and corruptions both score; the best score persists and the story save is untouched; quitting a run leaves a clean story game; a bot clears six waves |

Not covered: menus and cutscenes (they run off the audio clock), how anything looks or
sounds, gamepad and touch input, the level editor, and the real `setInterval` timing.
The Joe5 test forces the phase thresholds; it is not a played-out boss fight, and the
finishing move and the hand-off to level 6 are not tested.

## How it works

Nothing in the game's own source was changed for this. `tests/run.js` injects two files
into the page before the game's scripts run; `index.html` and the `include()` list never
mention them:

- **`tests/hooks.js`** defines `window.SFTest`. It
  - swallows the game's `setInterval(tick)`, so the game only advances when a test calls
    `SFTest.step(n)`;
  - replaces `Math.random` with a seeded generator;
  - takes drawing off `requestAnimationFrame`;
  - loads levels synchronously from text the runner read off disk.
- **`tests/bot.js`** defines `SFTest.bot` (see "The bot").

**A frame is one update followed by one draw.** The draw is not optional. Some game logic
(footsteps, smoke puffs, the StarvingArtist's walk) reads animation flags that only
`Animation.GetFrame()` refreshes, and that is only called while drawing. Stepping updates
without draws gives a different game. Draw code gets its own random stream so it cannot
disturb gameplay's.

**One difference from real play:** a level reached through a transition box arrives in
the same frame. In the real game a level that is not cached yet arrives a few frames
later, when its file has downloaded.

**Seeds.** `--seed N` changes the default seed for every test. The tests are written to
pass on any seed, and passed on seeds 1–10 when they were written. A test that fails
on one seed only is either a fragile test or a rare real bug, and worth a look.

## Writing a test

A file in `tests/scenarios/` exports one test or an array of them:

```js
const assert = require('assert');

module.exports = {
  name: 'grab: a Joe0 can be grabbed',
  async run(t) {
    // t.eval runs a function inside the game page and returns its JSON result.
    const r = await t.eval(() => {
      SFTest.newGame('arena');                      // fresh game in the empty test level
      var joe = SFTest.spawn('Joe0', 400, 0);       // constructor name, x, y
      var frames = SFTest.bot.drive(
        function () { if (SFTest.bot.approach(joe)) SFTest.bot.tap('grab', 3, 30); },
        function () { return player.captive === joe; },
        600);                                       // give up after 600 frames
      return { frames: frames, state: GetStateName(joe.state) };
    });
    assert.notStrictEqual(r.frames, -1, 'the grab never connected');
    assert.strictEqual(r.state, 'Captive');
  },
};
```

The function passed to `t.eval` runs in the page: it can use every game global
(`player`, `level`, `States`, …) but nothing from the Node file around it. Pass values
in as extra arguments: `t.eval((type) => { … }, 'Joe1')`.

Every test must start with `SFTest.newGame(...)` (or `SFTest.newArcade()`). Tests in one file share a page.

The parts of `SFTest` you will use most:

| | |
|---|---|
| `newGame(level, {seed, settle})` | Fresh game in a level (`'arena'`, `'level0'`…). Waits for the player to land unless `settle: false` |
| `newArcade({seed, settle})` | Start an arcade run, as the main menu's Arcade button does. Use it in place of `newGame` |
| `step(n)` / `stepUntil(fn, max)` | Advance n frames / until `fn()` is true (returns frames taken, or -1) |
| `press(b)` `release(b)` `hold(b, n)` `tap(b)` | Buttons: up down left right punch smoke grab special jump start poppers |
| `spawn(type, x, y, props)` | Add an entity at full health |
| `entities(type)` `enemies()` `nearestEnemy(d)` `orbs(kind)` `orbsInFlight()` | Look things up |
| `teleport(x, y)` `exitTo(level)` | Put the player somewhere; find a level's exit box |
| `snapshot()` `describe(e)` `roster()` `progress()` | Readable state, for assertions and messages |
| `digest()` | One number for the whole gameplay state; equal digests = same game |
| `checkSane()` | Throws if any entity has a NaN position or health |

`tests/fixtures/arena.json` is the empty test level: a walled corridor, 5000 wide and
320 deep, with nothing in it.

## The bot

`SFTest.bot.clearLevel(exitLevel, maxFrames)` plays the current level to its exit using
only the controller. It finds its way with a flood fill over the level's collision mask
(no per-level waypoints), fights whatever is close, punches or sidesteps when something
solid is in the way, and gives up when it makes no progress for 30 seconds of game time.
Its report says where it was, what it was doing and what was nearby.

It is there to catch softlocks and broken triggers, not to play well. Its lives are
topped up so it never reaches game over. It only punches; it never smokes, grabs, jumps
or uses poppers. Only levels 0 and 1 are tested. In a quick trial it also got through
level 4 (3 runs of 3) and level 3 (2 of 3), but not level 2: it cannot walk around the
checkpoint near the start.

For scenario tests there are smaller pieces: `bot.drive(policy, done, maxFrames)` runs
the game with `policy()` choosing buttons each frame, and inside a policy you can call
`bot.moveToward(x, y, tolX, tolY)`, `bot.approach(target)`, `bot.fight(target)`,
`bot.brawl(range)`, `bot.tap(button, hold, cool)` and `bot.hold(button)`.

## Recordings

```bash
node tests/run.js --record my-run --level level1
```

A Chrome window opens on that level. Click it and play. Close the window or press
Ctrl-C in the terminal to stop; the input is saved to `tests/recordings/my-run.json` and
replayed once straight away to check it reproduces. From then on `node tests/run.js`
replays it and fails if the game no longer plays out the same way.

A recording holds the level, the seed, every button change with its frame number, and a
digest of the game state every 60 frames.

Things to know:

- **Any gameplay change breaks recordings**, including intended ones: one extra random
  call shifts everything after it. A failure means "behaviour changed", which is a bug
  only if you did not mean it. If you did: `node tests/run.js --filter replay --update`.
- Keep recordings short and few. A minute of play covers a lot.
- Recording starts in the level, not at the title screen. Stay out of the pause menu and
  settings while recording.
- A key pressed and released inside one frame (under 17 ms) is not captured.
- The recorder watches the controller's buttons, so gamepad and touch input should
  record the same way as the keyboard. Only the keyboard has been tried.

The two recordings in the repo were not played by a person: `level1-keyboard` is scripted
key presses, `level1-bot-first-minute` is the bot. Replace them with your own.

## Known issues

A test with a `known: '...'` field documents a problem in the game. While it fails it is
listed as `known` and does not fail the run. If it starts passing, the runner says so;
remove the `known` field then, and the test guards the fix.

Currently there is one: **gameplay depends on how often the screen is drawn** (see
"How it works").
