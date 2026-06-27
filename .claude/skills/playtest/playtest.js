#!/usr/bin/env node
/*
 * playtest.js — drive Strange Flesh in a headless browser and screenshot a screen.
 *
 * Loads the game, unlocks WebAudio (the loader hard-gates on it), waits for
 * AllReady, optionally toggles widescreen, forces a given menu screen, sends
 * optional key presses, and writes a PNG.
 *
 * Requires puppeteer-core (see package.json) and an installed Chrome.
 * Set CHROME_PATH to override the Chrome binary location.
 *
 * Examples:
 *   node playtest.js --state mainmenu --widescreen --shot /tmp/sf/mainmenu_wide.png
 *   node playtest.js --state settings --width 2560 --height 1080 --shot /tmp/sf/settings.png
 *   node playtest.js --state mainmenu --keys Enter,ArrowDown,ArrowDown --shot /tmp/sf/nav.png
 */

const path = require('path');
const puppeteer = require(path.join(__dirname, 'node_modules', 'puppeteer-core'));

const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const a = {
    url: 'http://localhost:8000/index.html',
    width: 2560, height: 1080,
    widescreen: false,
    state: 'mainmenu',          // mainmenu | settings | controls | none
    keys: '',                   // comma-separated key names sent after reaching state
    shot: '/tmp/sf-playtest/shot.png',
    wait: 1000,                 // ms to settle before screenshot
  };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--widescreen') a.widescreen = true;
    else if (t === '--url') a.url = argv[++i];
    else if (t === '--width') a.width = +argv[++i];
    else if (t === '--height') a.height = +argv[++i];
    else if (t === '--state') a.state = argv[++i];
    else if (t === '--keys') a.keys = argv[++i];
    else if (t === '--shot') a.shot = argv[++i];
    else if (t === '--wait') a.wait = +argv[++i];
  }
  return a;
}

async function reachReady(page) {
  // Wait for assets to finish downloading
  for (let i = 0; i < 100; i++) {
    const pct = await page.evaluate(() => {
      try { return GlobalResourceLoader.loadPercentage; } catch (e) { return 0; }
    });
    if (pct > 99) break;
    await sleep(500);
  }
  // Unlock WebAudio: a trusted click + clear the loader's lock flag
  await page.mouse.click(Math.floor(page.viewport().width / 2),
                         Math.floor(page.viewport().height / 2));
  await page.evaluate(() => {
    try { if (typeof audioContext !== 'undefined') audioContext.resume(); } catch (e) {}
    try { GlobalResourceLoader.webAudioLocked = false; } catch (e) {}
  });
  for (let i = 0; i < 40; i++) {
    const ready = await page.evaluate(() => {
      try { return GlobalResourceLoader.AllReady(); } catch (e) { return false; }
    });
    if (ready) return true;
    await sleep(400);
  }
  return false;
}

async function forceState(page, state, widescreen) {
  return await page.evaluate((state, widescreen) => {
    // widescreenMode/getMenuOffsetX only exist on builds with the widescreen feature
    if (settings.hasOwnProperty('widescreenMode')) settings.widescreenMode = widescreen ? 1 : 0;
    resizeCanvas(true);
    var offset = (typeof getMenuOffsetX === 'function') ? getMenuOffsetX() : null;
    if (state === 'none') return { state, cW: c.width, menuOffsetX: offset };
    menuStack.length = 0;
    if (state === 'settings') { ShowSettingsMenu(false); }
    else if (state === 'controls') { ShowControlsMenu(); }
    else { // mainmenu
      var m = new MainMenu();
      m.Show();
      m.menuMode = true; m.menuTimer = 60; m.timer = 60;
    }
    return { state, cW: c.width, cH: c.height, menuOffsetX: offset };
  }, state, widescreen);
}

(async () => {
  const a = parseArgs(process.argv);
  require('fs').mkdirSync(require('path').dirname(a.shot), { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || DEFAULT_CHROME,
    headless: 'new',
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--mute-audio'],
    defaultViewport: { width: a.width, height: a.height, deviceScaleFactor: 1 },
  });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
    await page.goto(a.url, { waitUntil: 'load', timeout: 30000 });

    const ready = await reachReady(page);
    if (!ready) { console.log('WARN: AllReady never became true; capturing current frame'); }

    const diag = await forceState(page, a.state, a.widescreen);
    console.log('STATE:', JSON.stringify({ ...diag, ready, widescreen: a.widescreen }));

    if (a.keys) {
      for (const k of a.keys.split(',').map((s) => s.trim()).filter(Boolean)) {
        await page.keyboard.press(k);
        await sleep(150);
      }
    }
    await sleep(a.wait);
    await page.screenshot({ path: a.shot });
    console.log('SHOT:', a.shot);
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
