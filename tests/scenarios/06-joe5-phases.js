/*
 * The level 5 boss (Joe5) and its five AI phases. The triggers, as the code has
 * them (the comments in Joe5.js describe them differently):
 *   0 -> 1  once his intro is over and both he and the player are on the ground
 *   1 -> 2  his health reaches 410
 *   2 -> 3  the orc speaker is destroyed
 *   3 -> 4  his health reaches 205
 * The thresholds are forced here (health set directly) so each trigger is
 * checked on its own; this is not a played-out boss fight.
 */
const assert = require('assert');

module.exports = {
  name: 'Joe5: boss AI steps through phases 0 to 4 on the right triggers',
  async run(t) {
    const r = await t.eval(() => {
      SFTest.newGame('level5', { settle: false });
      var boss = SFTest.entities('Joe5')[0];
      var out = { maxHealth: boss.maxHealth, steps: [] };

      function record(label) {
        out.steps.push({ label: label, phase: boss.aiPhase, ai: boss.ai ? SFTest.typeName(boss.ai) : null,
                         bossState: GetStateName(boss.state), frame: SFTest.frame });
      }
      // Keep the player alive and out of the way: this test is about the boss.
      function run(maxFrames, until) {
        for (var i = 0; i < maxFrames; i++) {
          if (until()) return i;
          player.health = player.maxHealth;
          SFTest.step(1);
        }
        return until() ? maxFrames : -1;
      }

      SFTest.step(1);
      record('intro');
      out.introWasSpawning = boss.state === States.Spawning;
      out.hasOrcSpeaker = !!boss.orcSpeaker;

      out.introFrames = run(4000, function () { return boss.aiPhase === 1; });
      record('after intro');

      // Nothing else should move him on by itself.
      run(300, function () { return boss.aiPhase !== 1; });
      record('phase 1 holds');

      boss.health = 410;
      out.to2 = run(120, function () { return boss.aiPhase === 2; });
      record('health 410');

      // Health alone must not skip the speaker.
      boss.health = 100;
      run(120, function () { return boss.aiPhase !== 2; });
      record('low health, speaker alive');
      boss.health = 410;

      if (boss.orcSpeaker) boss.orcSpeaker.health = 0;
      out.to3 = run(900, function () { return boss.aiPhase === 3; });
      record('speaker destroyed');

      boss.health = 205;
      out.to4 = run(120, function () { return boss.aiPhase === 4; });
      record('health 205');

      out.level = level.levelName;
      out.bossInLevel = level.entities.list.indexOf(boss) !== -1;
      return out;
    });

    const step = (label) => r.steps.find((s) => s.label === label);
    assert.strictEqual(r.maxHealth, 615);
    assert.strictEqual(r.hasOrcSpeaker, true, 'the boss did not bring his orc speaker');
    assert.strictEqual(r.introWasSpawning, true, 'the boss should open in his Spawning intro');
    assert.deepStrictEqual([step('intro').phase, step('intro').ai], [0, 'BossPhase0AI']);

    assert.notStrictEqual(r.introFrames, -1, 'the boss never left his intro');
    assert.deepStrictEqual([step('after intro').phase, step('after intro').ai], [1, 'BossPhase1AI']);
    assert.strictEqual(step('phase 1 holds').phase, 1, 'phase 1 ended without its trigger');

    assert.notStrictEqual(r.to2, -1, 'health 410 did not start phase 2');
    assert.deepStrictEqual([step('health 410').phase, step('health 410').ai], [2, 'BossPhase2AI']);
    assert.strictEqual(step('low health, speaker alive').phase, 2, 'phase 2 ended while the speaker was still alive');

    assert.notStrictEqual(r.to3, -1, 'destroying the speaker did not start phase 3');
    assert.deepStrictEqual([step('speaker destroyed').phase, step('speaker destroyed').ai], [3, 'BossPhase3AI']);

    assert.notStrictEqual(r.to4, -1, 'health 205 did not start phase 4');
    assert.deepStrictEqual([step('health 205').phase, step('health 205').ai], [4, 'BossPhase4AI']);

    assert.strictEqual(r.level, 'level5');
    assert.strictEqual(r.bossInLevel, true);
    t.log(`intro lasted ${r.introFrames} frames; ` + r.steps.map((s) => `${s.label}=${s.phase}`).join(', '));
  },
};
