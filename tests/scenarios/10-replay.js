/*
 * Regression replays: every recording in tests/recordings is played back and
 * must reproduce the game state it was recorded with, frame for frame.
 *
 * A failure here means behaviour changed since the recording was made. That is
 * a bug if you did not mean to change gameplay; if you did, re-baseline with
 *   node tests/run.js --filter replay --update
 * Make a new recording with
 *   node tests/run.js --record NAME --level level1
 */
const assert = require('assert');
const recordings = require('../lib/recordings');

module.exports = recordings.list().map((name) => ({
  name: `replay: ${name}`,
  async run(t) {
    const rec = recordings.load(name);
    const result = await recordings.replay(t.page, rec);
    const diverged = recordings.firstDivergence(rec, result.digests);

    if (diverged !== null && t.update) {
      rec.digests = result.digests;
      recordings.save(name, rec);
      t.log(`re-baselined: digests rewritten from frame ${diverged.frame} on`);
      return;
    }

    const s = result.snapshot;
    assert.strictEqual(diverged, null, diverged === null ? '' :
      `the game no longer plays "${name}" the way it was recorded (${rec.recorded}).\n` +
      `It matches up to frame ${diverged.lastGood} and differs by frame ${diverged.frame} ` +
      `(of ${rec.frames}; ${rec.level}, seed ${rec.seed}).\n` +
      `The replay ended on ${s.level} with the player ${s.player.state} at ` +
      `${Math.round(s.player.x)},${Math.round(s.player.y)}, health ${s.player.health}.\n` +
      'If the change in behaviour is intended, re-baseline: node tests/run.js --filter replay --update');
    t.log(`${rec.frames} frames, ${rec.events.length} button changes, ${rec.digests.length} checkpoints`);
  },
}));
