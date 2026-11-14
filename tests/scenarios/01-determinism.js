/*
 * The foundation everything else stands on: the same seed and the same input
 * give exactly the same game, frame for frame, in two separate page loads.
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

module.exports = {
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
