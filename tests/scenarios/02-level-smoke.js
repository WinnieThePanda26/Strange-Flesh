/*
 * Every level loads and runs for ten seconds of game time without throwing,
 * without a NaN creeping into a position, and with the player on his feet.
 */
const assert = require('assert');

// staircase_test is left out: it is an engine stress-test level, not part of the
// game, and its spawn point sits inside a transition box that leads to level1.
const LEVELS = ['level0', 'level1', 'level2', 'level3', 'level4', 'level5', 'level6'];

module.exports = LEVELS.map((name) => ({
  name: `smoke: ${name} loads and runs 600 frames`,
  async run(t) {
    const r = await t.eval((name) => {
      SFTest.newGame(name, { settle: false });
      for (var f = 0; f < 600; f++) {
        SFTest.step(1);
        SFTest.checkSane();
      }
      return SFTest.snapshot();
    }, name);
    assert.strictEqual(r.level, name);
    assert.strictEqual(r.menuDepth, 0, `a ${r.menu} screen opened on its own`);
    assert.ok(r.player.health > 0, 'player lost all health standing still');
    t.log(`${r.entities.length} entities live, ${r.waitingToSpawn} waiting to spawn`);
  },
}));
