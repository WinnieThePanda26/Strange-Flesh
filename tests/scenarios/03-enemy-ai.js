/*
 * Enemy AI: every hostile enemy type goes after a player who is just standing
 * there, the two passive types behave as designed.
 */
const assert = require('assert');

// Types whose AI attacks the bartender on sight.
const HOSTILE = ['Joe1', 'Joe2', 'Joe3', 'Joe4', 'Admonitor', 'ColombianRescue', 'Bottley', 'EDRider',
                 'FartherFigure', 'Dissolution', 'PunkPuppy', 'PartyAnimal', 'Fister', 'VirusFromVenus'];

const tests = HOSTILE.map((type) => ({
  name: `AI: ${type} attacks an idle player`,
  async run(t) {
    const r = await t.eval((type) => {
      SFTest.newGame('arena');
      var enemy = SFTest.spawn(type, 700, 0);
      var frames = SFTest.stepUntil(function () { return player.health < player.maxHealth; }, 1500);
      return { frames: frames, enemy: SFTest.describe(enemy), health: player.health };
    }, type);
    assert.notStrictEqual(r.frames, -1,
      `${type} never hurt a player standing 700 away in 1500 frames (it ended up ${JSON.stringify(r.enemy)})`);
    t.log(`first hit after ${r.frames} frames`);
  },
}));

tests.push({
  name: 'AI: Joe0 is a pacifist and leaves an idle player alone',
  async run(t) {
    const r = await t.eval(() => {
      SFTest.newGame('arena');
      var joe = SFTest.spawn('Joe0', 300, 0);
      var attacked = false;
      for (var f = 0; f < 1200; f++) {
        SFTest.step(1);
        if (joe.state === States.BasicAttack) attacked = true;
      }
      return { attacked: attacked, health: player.health, maxHealth: player.maxHealth, joe: SFTest.describe(joe) };
    });
    assert.strictEqual(r.attacked, false, 'Joe0 threw an attack');
    assert.strictEqual(r.health, r.maxHealth, 'the player lost health');
    assert.strictEqual(r.joe.state, 'Walk');
  },
});

tests.push({
  name: 'AI: OfficeAngel runs from a nearby Admonitor',
  async run(t) {
    const r = await t.eval(() => {
      SFTest.newGame('arena');
      // Well away from the player, so only the two of them matter.
      var angel = SFTest.spawn('OfficeAngel', 1500, 0);
      var monitor = SFTest.spawn('Admonitor', 1800, 0, { ai: null });
      var startGap = Math.abs(angel.posX - monitor.posX);
      var frames = SFTest.stepUntil(function () { return Math.abs(angel.posX - monitor.posX) >= 600; }, 900);
      return { frames: frames, startGap: startGap, gap: Math.abs(angel.posX - monitor.posX), angel: SFTest.describe(angel) };
    });
    assert.notStrictEqual(r.frames, -1,
      `the angel only opened the gap from ${r.startGap} to ${Math.round(r.gap)} in 900 frames`);
    t.log(`out of range after ${r.frames} frames`);
  },
});

module.exports = tests;
