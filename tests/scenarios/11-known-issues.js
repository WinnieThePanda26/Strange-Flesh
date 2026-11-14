/*
 * Problems in the game that the harness turned up. Each test here states how
 * the game ought to behave, and is marked `known` because today it does not:
 * it is listed when the suite runs but does not fail it. When one is fixed the
 * runner says so, and the `known` flag should be removed so the test starts
 * guarding the fix.
 */
const assert = require('assert');

module.exports = [
  {
    name: 'known issue: gameplay should not depend on how often the screen is drawn',
    known: 'Some game logic reads animation flags (lastFrameWasTransition, lastDisplayedFrameIndex) that only ' +
      'Animation.GetFrame() refreshes, and GetFrame() is only called while drawing. Footsteps, smoke puffs and ' +
      "the StarvingArtist's walk therefore change when a draw is skipped (slow device, 30Hz display).",
    async run(t) {
      const r = await t.eval(() => {
        // The same input twice: once drawing after every update (what the tests
        // normally do), once drawing after every second update.
        function play(drawEvery) {
          SFTest.newGame('arena', { settle: false });
          SFTest.spawn('StarvingArtist', 600, 0);
          var digests = [];
          for (var f = 0; f < 900; f++) {
            if (f === 200) SFTest.press('smoke');
            if (f === 290) SFTest.release('smoke');
            if (f === 400) SFTest.press('right');
            updateAll();
            if (f % drawEvery === 0) SFTest.draw();
            SFTest.frame += 1;
            digests.push(SFTest.digest());
          }
          SFTest.releaseAll();
          return digests;
        }
        var everyFrame = play(1), everyOther = play(2), again = play(1);
        function firstDiff(a, b) { for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return i; return -1; }
        return { control: firstDiff(everyFrame, again), diverged: firstDiff(everyFrame, everyOther) };
      });
      assert.strictEqual(r.control, -1, 'the two identical runs differed, so this comparison means nothing');
      assert.strictEqual(r.diverged, -1,
        `drawing every second frame changed the game from frame ${r.diverged} on`);
    },
  },
];
