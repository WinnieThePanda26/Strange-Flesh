/*
 * recordings.js — input record / replay.
 *
 * A recording (tests/recordings/NAME.json) is: the level and seed it started
 * from, every controller button change with the frame it happened on, and a
 * digest of the game state every `digestEvery` frames. Replaying feeds the same
 * button changes to the same seeded game; if the digests still match, the game
 * behaves exactly as it did when the recording was made.
 */

const fs = require('fs');
const path = require('path');
const h = require('./harness');

const DIR = path.join(h.TESTS, 'recordings');
const DIGEST_EVERY = 60;

function file(name) {
  return path.join(DIR, name.replace(/\.json$/, '') + '.json');
}

function list() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort().map((f) => f.replace(/\.json$/, ''));
}

function load(name) {
  return JSON.parse(fs.readFileSync(file(name), 'utf8'));
}

function save(name, rec) {
  fs.mkdirSync(DIR, { recursive: true });
  // One event / digest per line keeps diffs of a re-baselined recording readable.
  const lines = (arr) => '[\n' + arr.map((x) => '    ' + JSON.stringify(x)).join(',\n') + '\n  ]';
  const text = '{\n' +
    `  "level": ${JSON.stringify(rec.level)},\n` +
    `  "seed": ${rec.seed},\n` +
    `  "frames": ${rec.frames},\n` +
    `  "digestEvery": ${rec.digestEvery},\n` +
    `  "recorded": ${JSON.stringify(rec.recorded)},\n` +
    `  "events": ${lines(rec.events)},\n` +
    `  "digests": ${lines(rec.digests)}\n` +
    '}\n';
  fs.writeFileSync(file(name), text);
}

// Replay a recording in `page` as fast as it will go. Returns
// { digests, snapshot } for the caller to compare against the recording.
async function replay(page, rec) {
  return await page.evaluate((rec) => {
    SFTest.newGame(rec.level, { seed: rec.seed, settle: false });
    var digests = SFTest.replay(rec.events, rec.frames, rec.digestEvery);
    return { digests: digests, snapshot: SFTest.snapshot() };
  }, rec);
}

// Where a replay first disagrees with its recording: null if it never does,
// otherwise the frame of the first differing digest and the last one that agreed.
function firstDivergence(rec, digests) {
  let lastGood = 0;
  for (let i = 0; i < rec.digests.length; i++) {
    if (!digests[i] || digests[i][0] !== rec.digests[i][0] || digests[i][1] !== rec.digests[i][1]) {
      return { frame: rec.digests[i][0], lastGood };
    }
    lastGood = rec.digests[i][0];
  }
  return null;
}

// --record NAME: play in a visible window; input goes to tests/recordings/NAME.json.
// opts.player: an async function(page) that plays instead of a person (scripted
// key presses); the session then ends when it returns.
async function record(args, browser, base, opts) {
  opts = opts || {};
  const name = args.record;
  if (fs.existsSync(file(name))) {
    console.error(`tests/recordings/${name}.json already exists. Delete it first, or pick another name.`);
    return 2;
  }

  const page = await h.openGame(browser, base, { seed: args.seed });
  await page.evaluate((level, seed, every) => {
    SFTest.newGame(level, { seed: seed, settle: false });
    SFTest.startRecording(every);
  }, args.level, args.seed, DIGEST_EVERY);

  console.log(`Recording "${name}" on ${args.level} (seed ${args.seed}).`);
  let stop = false;
  if (opts.player) {
    opts.player(page).then(() => { stop = true; }, (e) => { console.error(e); stop = true; });
  } else {
    console.log('Play in the Chrome window (click it first so it has the keyboard).');
    console.log('Close the window, or press Ctrl-C here, to stop and save.\n');
  }
  const onSigint = () => { stop = true; };
  process.on('SIGINT', onSigint);

  // Poll what has been recorded so far, so closing the window loses nothing.
  let latest = null;
  while (!stop) {
    try {
      const soFar = await page.evaluate(() => SFTest.recordingSoFar());
      if (soFar) latest = soFar;
      if (soFar && soFar.error) { console.error('The game threw while recording:\n' + soFar.error); break; }
    } catch (e) {
      break;   // the window was closed
    }
    await h.sleep(250);
  }
  process.removeListener('SIGINT', onSigint);

  if (!latest || latest.frames < DIGEST_EVERY) {
    console.log('Nothing recorded (less than a second of play).');
    return 1;
  }

  // Keep whole digest intervals only, so the recording ends on a checked frame.
  const frames = Math.floor(latest.frames / DIGEST_EVERY) * DIGEST_EVERY;
  const rec = {
    level: args.level,
    seed: args.seed,
    frames,
    digestEvery: DIGEST_EVERY,
    recorded: new Date().toISOString().slice(0, 10),
    events: latest.events.filter((e) => e[0] < frames),
    digests: latest.digests.filter((d) => d[0] <= frames),
  };

  // Check it right away: replay it headlessly and make sure it reproduces.
  let verdict = '';
  let code = 0;
  let headless = null;
  try {
    headless = await h.launchBrowser({});
    const check = await h.openGame(headless, base, { seed: args.seed });
    const result = await replay(check, rec);
    const diverged = firstDivergence(rec, result.digests);
    if (diverged === null) {
      verdict = 'Replayed it once to check: it reproduces exactly.';
    } else {
      verdict = `WARNING: an immediate replay diverged at frame ${diverged.frame} ` +
        `(matched up to frame ${diverged.lastGood}). The recording was saved, but it is not a reliable ` +
        'regression test. Usual causes: a key pressed and released within one frame, or changing a ' +
        'setting / using the pause menu while recording.';
      code = 1;
    }
  } catch (e) {
    verdict = 'Could not check the recording by replaying it: ' + e.message;
    code = 1;
  } finally {
    if (headless) await headless.close().catch(() => {});
  }

  save(name, rec);
  console.log(`Saved tests/recordings/${name}.json: ${rec.frames} frames ` +
    `(${Math.round(rec.frames / 60)}s), ${rec.events.length} button changes.`);
  console.log(verdict);
  return code;
}

// Run the game in real time in a visible window until `done()` (evaluated in the
// page) says so or the window is closed.
async function watchUntilDone(page) {
  for (;;) {
    let state;
    try {
      state = await page.evaluate(() => window.__sfWatch);
    } catch (e) {
      return null;   // window closed
    }
    if (state && state.done) return state;
    await h.sleep(250);
  }
}

// --watch NAME: play a recording back at normal speed in a visible window.
async function watch(args, browser, base) {
  const name = args.watch;
  if (!fs.existsSync(file(name))) {
    console.error(`No recording called "${name}". Recordings: ${list().join(', ') || '(none)'}`);
    return 2;
  }
  const rec = load(name);
  const page = await h.openGame(browser, base, { seed: rec.seed });
  console.log(`Playing "${name}" (${rec.level}, ${Math.round(rec.frames / 60)}s). Close the window to stop.`);
  await page.evaluate((rec) => {
    SFTest.newGame(rec.level, { seed: rec.seed, settle: false });
    var next = 0;
    window.__sfWatch = { done: false };
    SFTest.runRealtime(function (frame) {
      while (next < rec.events.length && rec.events[next][0] <= frame) {
        controller[rec.events[next][1] + (rec.events[next][2] ? 'KeyDown' : 'KeyUp')]();
        next += 1;
      }
      if (frame >= rec.frames) { window.__sfWatch = { done: true }; return false; }
      return true;
    });
  }, rec);
  await watchUntilDone(page);
  return 0;
}

// --watch-bot LEVEL: watch the bot play a level at normal speed.
async function watchBot(args, browser, base) {
  const from = args.watchBot;
  const next = { level0: 'level1', level1: 'level2', level2: 'level3', level3: 'level4', level4: 'level5' }[from];
  if (!next) {
    console.error('--watch-bot takes level0, level1, level2, level3 or level4');
    return 2;
  }
  const page = await h.openGame(browser, base, { seed: args.seed });
  console.log(`Bot playing ${from} (seed ${args.seed}). Close the window to stop.`);
  await page.evaluate((from, next) => {
    SFTest.newGame(from, { settle: false });
    var brain = SFTest.bot.makeBrain(next);
    window.__sfWatch = { done: false };
    SFTest.runRealtime(function () {
      var outcome = brain.tick();
      if (outcome !== null) { window.__sfWatch = { done: true, report: brain.report() }; return false; }
      return true;
    });
  }, from, next);
  const state = await watchUntilDone(page);
  if (state && state.report) {
    console.log(`Bot finished: ${state.report.outcome} after ${state.report.frames} frames (${state.report.doing}).`);
  }
  return 0;
}

module.exports = { DIR, list, load, save, replay, firstDivergence, record, watch, watchBot };
