/*
 * The foundation everything else stands on: the same seed and the same input
 * give exactly the same game, frame for frame, in two separate page loads.
 * (A frame here is one update followed by one draw; see tests/hooks.js.)
 */
const assert = require('assert');

// Hold right and tap punch through level 1 for `frames` updates, returning a
// state digest for every frame.
function playLevel1(seed, frames) {
  SFTest.newGame('level1', { seed: seed, settle: false });
  var digests = [];
  SFTest.press('right');
  for (var f = 0; f < frames; f++) {
    if (f % 20 === 0) SFTest.press('punch');
    if (f % 20 === 4) SFTest.release('punch');
    SFTest.step(1);
    digests.push(SFTest.digest());
  }
  return { digests: digests, snapshot: SFTest.snapshot() };
}

function firstDifference(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i;
  return -1;
}

// In-page: play several quite different games, to leave as much behind in the
// page as a game can.
function playOtherGames() {
  var bot = SFTest.bot;
  SFTest.newGame('level0');
  bot.clearLevel('level1', 8000);
  SFTest.newGame('arena');
  var joe = SFTest.spawn('Joe1', 400, 0);
  bot.drive(function () { bot.fight(joe); }, function () { return joe.state === States.Dead; }, 3000);
  SFTest.newGame('level5', { settle: false });
  SFTest.step(900);
  SFTest.newGame('level1');
  saveGame();
  SFTest.newGame('level0');
  loadGame();
  SFTest.step(200);
}

const sameSeed = {
  name: 'determinism: same seed replays level 1 identically, another seed does not',
  async run(t) {
    const FRAMES = 3600;
    const first = await t.eval(playLevel1, 1234, FRAMES);

    // A second, completely separate page load.
    const h = require('../lib/harness');
    const base = new URL(t.page.url()).origin;
    const page2 = await h.openGame(t.page.browser(), base, { seed: t.seed });
    try {
      const second = await page2.evaluate(playLevel1, 1234, FRAMES);
      const diff = firstDifference(first.digests, second.digests);
      assert.strictEqual(diff, -1, `two runs with seed 1234 diverged at frame ${diff}`);

      const third = await page2.evaluate(playLevel1, 4321, FRAMES);
      assert.notStrictEqual(firstDifference(first.digests, third.digests), -1,
        'a different seed produced an identical run: the seed is not reaching the game');
    } finally {
      await page2.close();
    }

    // The run should have been a real one: the player moved and fought.
    assert.ok(first.snapshot.player.x > 2000, `player only reached x=${first.snapshot.player.x}`);
    assert.ok(first.snapshot.rngCalls > 1000, 'gameplay barely used the random generator');
    t.log(`player reached x=${first.snapshot.player.x}, ${first.snapshot.rngCalls} random calls`);
  },
};

// The runner lets the tests in a file share one page, each starting from
// SFTest.newGame(). That is only sound if newGame() leaves nothing behind.
const cleanSlate = {
  name: 'determinism: a new game in a used page plays the same as in a fresh page',
  async run(t) {
    const FRAMES = 3000;
    const fresh = await t.eval(playLevel1, 1234, FRAMES);
    await t.eval(playOtherGames);
    const used = await t.eval(playLevel1, 1234, FRAMES);
    const diff = firstDifference(fresh.digests, used.digests);
    assert.strictEqual(diff, -1,
      `after other games had been played in the page, the same game diverged at frame ${diff}: ` +
      'something survives SFTest.newGame()');
  },
};

module.exports = [cleanSlate, sameSeed];
