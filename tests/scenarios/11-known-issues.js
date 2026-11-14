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
  {
    name: 'known issue: orbs still flying to the HUD should not be credited to the next game',
    known: 'HUD.Reset() does not clear hud.orbs, so an orb picked up just before quitting to the title ' +
      'screen finishes its flight in the next game and bumps that game\'s meter (or health, or lives).',
    async run(t) {
      const r = await t.eval(() => {
        SFTest.newGame('arena');
        var bot = SFTest.bot;
        var joe = SFTest.spawn('Joe0', 400, 0);
        bot.drive(function () {
          var orbs = SFTest.orbs(ORB_DOMINATE);
          if (joe.state !== States.Dead) bot.fight(joe);
          else if (orbs.length) bot.moveToward(orbs[0].posX, orbs[0].posY, 10, 10);
        }, function () { return SFTest.orbsInFlight() > 0; }, 3000);
        var out = { inFlight: SFTest.orbsInFlight(), before: enemiesDispatched };

        // What "Exit to Title" then "New Game" does to the HUD and the meters.
        hud.Reset();
        enemiesDispatched = 0;
        enemiesCorrupted = 0;
        out.inFlightAfterReset = SFTest.orbsInFlight();
        SFTest.step(400);
        out.after = enemiesDispatched;
        return out;
      });
      assert.ok(r.inFlight > 0, 'could not get an orb into flight to set the situation up');
      assert.strictEqual(r.after, 0,
        `${r.after} domination orb(s) from the previous game were counted after the reset`);
    },
  },
];
