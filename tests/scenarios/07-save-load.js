/*
 * Save / load round trip: play a bit of level 1, save, throw the whole game
 * away, load, and check everything a save is meant to carry came back.
 */
const assert = require('assert');

module.exports = {
  name: 'save/load: progress on level 1 survives a save, a wipe and a load',
  async run(t) {
    const r = await t.eval(() => {
      var bot = SFTest.bot;
      SFTest.newGame('level1');
      localStorage.removeItem('SavedGame');
      var out = { existedBefore: savedGameExists() };

      // Make some progress worth saving: beat up the first few locals.
      out.fightFrames = bot.drive(function () { bot.brawl(900); },
        function () { return enemiesDispatched >= 4; }, 9000);
      SFTest.stepUntil(function () { return SFTest.orbsInFlight() === 0 && OkToSave(player.state) && player.posZ === 0; }, 600);

      // Values a fresh game would not have.
      lives = 3;
      poppers = 2;
      player.health = 137;
      player.sexMeter = 420;

      // A save stores positions on a 3-pixel grid, so compare on that grid.
      out.before = SFTest.progress(3);
      saveGame();
      out.existsAfterSave = savedGameExists();
      out.savedBytes = localStorage.getItem('SavedGame').length;
      out.afterSave = SFTest.progress(3);

      // Throw everything away, then load.
      SFTest.newGame('level0');
      out.wiped = SFTest.progress(3);
      out.loadedLevel = loadGame();
      out.after = SFTest.progress(3);
      out.playerStateAfterLoad = GetStateName(player.state);

      // And the loaded game has to actually run.
      for (var f = 0; f < 300; f++) { SFTest.step(1); SFTest.checkSane(); }
      out.later = SFTest.snapshot();
      return out;
    });

    assert.strictEqual(r.existedBefore, false);
    assert.notStrictEqual(r.fightFrames, -1, 'could not make any progress to save');
    assert.strictEqual(r.existsAfterSave, true, 'saveGame() left nothing in localStorage');
    assert.deepStrictEqual(r.afterSave, r.before, 'saving changed the game it was saving');

    assert.strictEqual(r.wiped.level, 'level0');
    assert.strictEqual(r.wiped.enemiesDispatched, 0, 'the wipe between save and load did not wipe');

    assert.strictEqual(r.loadedLevel, 'level1');
    const { roster: rosterBefore, ...before } = r.before;
    const { roster: rosterAfter, ...after } = r.after;
    assert.deepStrictEqual(after, before, 'player progress after loading');
    assert.deepStrictEqual(rosterAfter, rosterBefore, 'the entities in the level after loading');
    assert.ok(rosterBefore.length > 20, 'the roster looks too small to be level 1');

    assert.strictEqual(r.later.level, 'level1');
    assert.strictEqual(r.later.menuDepth, 0);
    t.log(`saved ${r.savedBytes} bytes; ${rosterBefore.length} entities, ${before.enemiesDispatched} domination orbs, ` +
      `player at ${before.x},${before.y}`);
  },
};
