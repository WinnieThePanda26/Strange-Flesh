/*
 * harness.js — Node-side plumbing for tests/run.js: preflight checks, the static
 * server, the browser (through the playtest skill's puppeteer-core), and opening
 * a game page with the test hooks installed.
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const TESTS = path.join(ROOT, 'tests');
const SKILL = path.join(ROOT, '.claude', 'skills', 'playtest');
const OUT = path.join(TESTS, 'out');

const VIEWPORT = { width: 1280, height: 720 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Everything the harness needs that is not in the repo. Returns a list of
// problems (empty when good to go).
function preflight() {
  const problems = [];
  if (!fs.existsSync(path.join(SKILL, 'node_modules', 'puppeteer-core'))) {
    problems.push('puppeteer-core is not installed. Run:\n    npm --prefix .claude/skills/playtest install');
  }
  for (const dir of ['images', 'sound']) {
    if (!fs.existsSync(path.join(ROOT, dir))) {
      problems.push(`${dir}/ is missing. The tests need the media pack (see README.md): ` +
        'animation timing comes from the sprite sheets.');
    }
  }
  if (problems.length === 0) {
    const chrome = process.env.CHROME_PATH || require(path.join(SKILL, 'common.js')).DEFAULT_CHROME;
    if (!fs.existsSync(chrome)) {
      problems.push(`Chrome not found at ${chrome}. Set CHROME_PATH to your Chrome binary.`);
    }
  }
  return problems;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function httpOk(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
  });
}

// Start serve.py (the repo's no-cache static server) on a spare port.
async function startServer() {
  const port = await freePort();
  const child = spawn('python3', ['serve.py', '--port', String(port)], { cwd: ROOT, stdio: 'ignore' });
  let exited = false;
  child.on('exit', () => { exited = true; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (exited) throw new Error('serve.py exited before it started serving (is python3 installed?)');
    if (await httpOk(base + '/index.html')) {
      return { base, stop: () => { if (!exited) child.kill(); } };
    }
    await sleep(100);
  }
  child.kill();
  throw new Error('serve.py did not start serving within 10 seconds');
}

async function launchBrowser(opts) {
  const { launch } = require(path.join(SKILL, 'common.js'));
  return await launch(VIEWPORT.width, VIEWPORT.height, opts);
}

// Level descriptors, read from disk and handed to the page so levels load
// synchronously: every levels/*.txt plus the fixtures in tests/fixtures.
function readLevels() {
  const levels = {};
  for (const file of fs.readdirSync(path.join(ROOT, 'levels'))) {
    if (file.endsWith('.txt')) {
      levels[file.replace(/\.txt$/, '')] = fs.readFileSync(path.join(ROOT, 'levels', file), 'utf8');
    }
  }
  for (const file of fs.readdirSync(path.join(TESTS, 'fixtures'))) {
    if (file.endsWith('.json')) {
      levels[file.replace(/\.json$/, '')] = fs.readFileSync(path.join(TESTS, 'fixtures', file), 'utf8');
    }
  }
  return levels;
}

function inPageSources() {
  return ['hooks.js', 'bot.js']
    .map((f) => path.join(TESTS, f))
    .filter((f) => fs.existsSync(f))
    .map((f) => fs.readFileSync(f, 'utf8'));
}

// Open the game in a new page with the hooks installed, wait for every resource
// to load, then freeze drawing. The page comes back ready for SFTest.newGame().
async function openGame(browser, base, opts) {
  opts = opts || {};
  const page = await browser.newPage();
  page.sfErrors = [];
  page.on('pageerror', (e) => page.sfErrors.push(e.message));
  if (opts.onConsole) page.on('console', (m) => opts.onConsole(m.text()));

  for (const source of inPageSources()) await page.evaluateOnNewDocument(source);
  await page.goto(base + '/index.html', { waitUntil: 'load', timeout: 30000 });

  // The loader gates on a WebAudio unlock: give it a trusted click and clear the
  // flag (same thing the playtest skill does), then wait on AllReady itself.
  await page.mouse.click(Math.floor(VIEWPORT.width / 2), Math.floor(VIEWPORT.height / 2));
  let ready = false;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    ready = await page.evaluate(() => {
      try {
        if (typeof audioContext !== 'undefined') audioContext.resume();
        GlobalResourceLoader.webAudioLocked = false;
        return GlobalResourceLoader.AllReady();
      } catch (e) { return false; }
    });
    if (ready) break;
    await sleep(50);
  }
  if (!ready) {
    const detail = await page.evaluate(() => {
      try { return GlobalResourceLoader.errorMessages.join('; '); } catch (e) { return String(e); }
    });
    throw new Error('the game never finished loading' + (detail ? ': ' + detail : '') +
      (page.sfErrors.length ? ' (page errors: ' + page.sfErrors.join(' | ') + ')' : ''));
  }

  await page.evaluate((levels, seed, live) => {
    for (const name in levels) SFTest.levelText[name] = levels[name];
    SFTest.defaultSeed = seed;
    if (!live) SFTest.freeze();
  }, readLevels(), opts.seed === undefined ? 1 : opts.seed, !!opts.live);

  return page;
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

// Save what the game looked like when a test failed: a state dump and a
// screenshot. Returns the folder, or null if nothing could be saved.
async function dumpFailure(page, name) {
  const dir = path.join(OUT, slug(name));
  try {
    fs.mkdirSync(dir, { recursive: true });
    const snap = await page.evaluate(() => {
      try { return SFTest.snapshot(); } catch (e) { return { error: String(e) }; }
    });
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(snap, null, 2));
    await page.evaluate(() => { try { SFTest.draw(); } catch (e) {} });
    await page.screenshot({ path: path.join(dir, 'screenshot.png') });
    return dir;
  } catch (e) {
    return null;
  }
}

module.exports = {
  ROOT, TESTS, OUT, VIEWPORT, sleep, slug,
  preflight, startServer, launchBrowser, openGame, dumpFailure, readLevels,
};
