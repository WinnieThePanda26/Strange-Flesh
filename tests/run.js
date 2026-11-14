#!/usr/bin/env node
/*
 * run.js — the Strange Flesh test runner.
 *
 *   node tests/run.js                      run every test
 *   node tests/run.js --filter grab        only tests whose name or file contains "grab"
 *   node tests/run.js --seed 7             run with a different random seed
 *   node tests/run.js --list               list the tests without running them
 *   node tests/run.js --update             re-baseline replay recordings to current behaviour
 *
 *   node tests/run.js --record NAME --level level1 [--seed N]
 *                                          play in a visible window; your input is saved to
 *                                          tests/recordings/NAME.json (close the window to stop)
 *   node tests/run.js --watch NAME         watch a recording play back in a visible window
 *   node tests/run.js --watch-bot level1   watch the bot play a level in a visible window
 *
 * See tests/README.md.
 */

const fs = require('fs');
const path = require('path');
const h = require('./lib/harness');
const recordings = require('./lib/recordings');

function parseArgs(argv) {
  const a = { filter: null, seed: 1, list: false, update: false, record: null, level: 'level1',
              watch: null, watchBot: null, verbose: false };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--filter') a.filter = argv[++i];
    else if (t === '--seed') a.seed = +argv[++i];
    else if (t === '--list') a.list = true;
    else if (t === '--update') a.update = true;
    else if (t === '--record') a.record = argv[++i];
    else if (t === '--level') a.level = argv[++i];
    else if (t === '--watch') a.watch = argv[++i];
    else if (t === '--watch-bot') a.watchBot = argv[++i];
    else if (t === '--verbose' || t === '-v') a.verbose = true;
    else if (t === '--help' || t === '-h') a.help = true;
    else { console.error('Unknown option: ' + t); a.help = true; a.bad = true; }
  }
  return a;
}

function usage() {
  const src = fs.readFileSync(__filename, 'utf8');
  console.log(src.slice(src.indexOf('/*') + 3, src.indexOf('*/')).replace(/^ \* ?/gm, ''));
}

// Each file in tests/scenarios exports one test or an array of them:
//   { name, run: async (t) => {...}, timeout? (ms) }
function loadTests(filter) {
  const dir = path.join(h.TESTS, 'scenarios');
  const tests = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
    const exported = require(path.join(dir, file));
    for (const test of [].concat(exported)) tests.push({ ...test, file });
  }
  if (!filter) return tests;
  const needle = filter.toLowerCase();
  return tests.filter((t) => (t.name + ' ' + t.file).toLowerCase().includes(needle));
}

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function indent(text, pad) {
  return String(text).split('\n').map((line) => pad + line).join('\n');
}

async function runTests(args, browser, base) {
  const tests = loadTests(args.filter);
  if (tests.length === 0) {
    console.log('No tests match.');
    return 1;
  }
  fs.rmSync(h.OUT, { recursive: true, force: true });

  console.log(`Strange Flesh tests (seed ${args.seed})\n`);
  let failed = 0;
  const started = Date.now();

  for (const test of tests) {
    const t0 = Date.now();
    const logs = [];
    let page = null;
    let error = null;
    try {
      page = await h.openGame(browser, base, { seed: args.seed });
      const t = {
        page,
        seed: args.seed,
        update: args.update,
        log: (msg) => logs.push(String(msg)),
        // Run a function inside the game page and return its (JSON) result.
        eval: (fn, ...fnArgs) => page.evaluate(fn, ...fnArgs),
      };
      await withTimeout(test.run(t), test.timeout || 120000, 'test');
      if (page.sfErrors.length) throw new Error('page errors: ' + page.sfErrors.join(' | '));
    } catch (e) {
      error = e;
    }

    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (error === null) {
      console.log(`  ok    ${test.name}  (${secs}s)`);
      if (args.verbose) logs.forEach((l) => console.log(indent(l, '          ')));
    } else {
      failed += 1;
      console.log(`  FAIL  ${test.name}  (${secs}s)  [${test.file}]`);
      const message = (error.name === 'AssertionError' || !error.stack) ? error.message : error.stack;
      console.log(indent(message, '          '));
      logs.forEach((l) => console.log(indent(l, '          ')));
      if (page) {
        const dir = await h.dumpFailure(page, test.name);
        if (dir) console.log(`          state + screenshot: ${path.relative(h.ROOT, dir)}/`);
      }
    }
    if (page) await page.close().catch(() => {});
  }

  const total = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${tests.length - failed} passed, ${failed} failed  (${total}s)`);
  return failed ? 1 : 0;
}

(async () => {
  const args = parseArgs(process.argv);
  if (args.help) { usage(); process.exit(args.bad ? 2 : 0); }

  if (args.list) {
    for (const t of loadTests(args.filter)) console.log(`${t.file}: ${t.name}`);
    return;
  }

  const problems = h.preflight();
  if (problems.length) {
    console.error('Cannot run the tests:\n' + problems.map((p) => '  - ' + p).join('\n'));
    process.exit(2);
  }

  const visible = !!(args.record || args.watch || args.watchBot);
  const server = await h.startServer();
  let browser = null;
  let code = 1;
  try {
    browser = await h.launchBrowser({ headless: !visible });
    if (args.record) code = await recordings.record(args, browser, server.base);
    else if (args.watch) code = await recordings.watch(args, browser, server.base);
    else if (args.watchBot) code = await recordings.watchBot(args, browser, server.base);
    else code = await runTests(args, browser, server.base);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.stop();
  }
  process.exit(code);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
