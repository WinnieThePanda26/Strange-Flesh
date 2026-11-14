/*
 * A bot plays levels 0 and 1 from spawn to exit using nothing but the
 * controller (tests/bot.js). It is there to catch softlocks and broken
 * triggers: an exit that cannot be reached, a skirmish that never unlocks, a
 * door that will not break. It fails when it makes no progress for 30 seconds
 * of game time, and says where it was and what it was trying to do.
 *
 * The bot's lives are topped up so it can never reach game over; deaths are
 * reported, not failed on.
 */
const assert = require('assert');

function describeFailure(r) {
  const p = r.player;
  const near = r.nearbyEnemies.map((e) => `${e.type} ${e.state} hp${e.health} at ${Math.round(e.x)},${Math.round(e.y)}`);
  return [
    `bot ${r.outcome === 'timeout' ? 'ran out of frames' : 'got ' + r.outcome} on ${r.from} at frame ${r.frames}`,
    `  it was: ${r.doing}`,
    `  player: ${p.state} at ${Math.round(p.x)},${Math.round(p.y)} (z ${Math.round(p.z)}), health ${p.health}`,
    `  best distance to the exit: ${r.cellsFromExit === null ? 'no route found' : r.cellsFromExit + ' cells'}`,
    `  last progress ${r.framesSinceProgress} frames ago: ${r.lastProgress}`,
    `  skirmishes cleared: ${r.skirmishesCleared}${r.skirmishActive ? ' (one is locked right now)' : ''}`,
    `  enemies nearby: ${near.length ? near.join('; ') : 'none'}`,
    '  what it did last:',
    ...r.log.slice(-8).map((l) => '    ' + l),
  ].join('\n');
}

function botTest(from, to, maxFrames, skirmishes) {
  return {
    name: `bot: plays ${from} through to ${to}`,
    timeout: 240000,
    async run(t) {
      const r = await t.eval((from, to, maxFrames) => {
        SFTest.newGame(from);
        return SFTest.bot.clearLevel(to, maxFrames);
      }, from, to, maxFrames);
      assert.strictEqual(r.outcome, 'exit', describeFailure(r));
      assert.strictEqual(r.level, to);
      assert.strictEqual(r.skirmishesCleared, skirmishes, `${from} has ${skirmishes} skirmishes to clear on the way`);
      t.log(`${r.frames} frames (${Math.round(r.frames / 60)}s of play), ${r.deaths} deaths, ` +
        `${r.skirmishesCleared} skirmishes, ${r.enemiesDispatched} domination orbs`);
    },
  };
}

module.exports = [
  botTest('level0', 'level1', 8000, 0),
  botTest('level1', 'level2', 45000, 2),
];
