// Screenshot every panel state from extension/dev/preview.html and run keyboard checks.
// Usage: node tools/preview-shots.mjs   (exits 1 on any console error, page error or failed check)
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const previewUrl = pathToFileURL(path.join(here, '..', 'extension', 'dev', 'preview.html')).href;
const shotsDir = path.join(here, 'shots');
fs.mkdirSync(shotsDir, { recursive: true });

const STATES = ['ok', 'ok-live-exact', 'ok-sparse', 'ok-thin', 'no_match', 'outside_coverage', 'error',
  'detecting', 'need_address', 'loading', 'transport_error', 'collapsed'];
const RUNS = STATES.map((s) => ({ state: s, width: 1440, height: 900, file: `preview-${s}.png` }))
  .concat([{ state: 'ok', width: 1280, height: 720, file: 'preview-ok-1280x720.png' }]);

const problems = [];
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbx-'));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  viewport: { width: 1440, height: 900 },
  reducedMotion: 'reduce'
});

function watch(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`${label}: console error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`${label}: page error: ${err.message}`));
}

async function open(state, width, height) {
  const page = await context.newPage();
  watch(page, `#${state} ${width}x${height}`);
  await page.setViewportSize({ width, height });
  await page.goto(`${previewUrl}#${state}`);
  await page.waitForSelector('#mbx-root', { state: 'attached' });
  await page.waitForTimeout(150); // let the rAF layout probes (DA "More" toggle) run
  return page;
}

function check(cond, msg) {
  if (!cond) problems.push(`check failed: ${msg}`);
}

try {
  for (const run of RUNS) {
    const page = await open(run.state, run.width, run.height);
    const attrs = await page.evaluate(() => {
      const host = document.getElementById('mbx-root');
      return { names: host.getAttributeNames(), state: host.getAttribute('data-mbx-state'), roots: document.querySelectorAll('#mbx-root').length };
    });
    check(attrs.roots === 1, `#${run.state}: exactly one #mbx-root`);
    check(attrs.names.every((n) => n === 'id' || n.startsWith('data-mbx-')), `#${run.state}: host has only id + data-mbx-* (${attrs.names.join(',')})`);
    // the panel must fit inside the viewport
    const box = await page.evaluate(() => {
      const sr = document.getElementById('mbx-root').shadowRoot;
      const el = sr.querySelector('.panel:not([hidden])') || sr.querySelector('.pill');
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    });
    check(box.bottom <= run.height && box.right <= run.width && box.left >= 0, `#${run.state} ${run.width}x${run.height}: panel inside viewport ${JSON.stringify(box)}`);
    await page.screenshot({ path: path.join(shotsDir, run.file) });
    console.log(`shot ${run.file}  state=${attrs.state}`);
    await page.close();
  }

  // Keyboard: Tab reaches the header buttons, the text buttons and the input; Esc collapses; Enter on the pill expands.
  {
    const page = await open('ok', 1440, 900);
    const seen = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      seen.push(await page.evaluate(() => {
        const a = document.getElementById('mbx-root').shadowRoot.activeElement;
        return a ? (a.getAttribute('aria-label') || a.textContent.trim() || a.tagName) : null;
      }));
    }
    console.log('tab order (#ok):', seen.join(' | '));
    check(seen[0] === 'Collapse Listing Check', 'first Tab lands on the collapse button');
    check(seen.includes('Close Listing Check'), 'Tab reaches the close button');
    check(seen.includes('Wrong home? Enter the address'), 'Tab reaches "Wrong home?"');
    // focus ring screenshot on the collapse button
    await page.keyboard.press('Shift+Tab');
    for (let i = 0; i < 8; i++) {
      const cur = await page.evaluate(() => document.getElementById('mbx-root').shadowRoot.activeElement?.getAttribute('aria-label'));
      if (cur === 'Collapse Listing Check') break;
      await page.keyboard.press('Shift+Tab');
    }
    await page.screenshot({ path: path.join(shotsDir, 'preview-focus.png'), clip: { x: 1440 - 400, y: 70, width: 400, height: 200 } });

    // reveal the address input via "Wrong home?" and type into it
    const sr = await page.evaluateHandle(() => document.getElementById('mbx-root').shadowRoot);
    const wrong = await sr.evaluateHandle((r) => [...r.querySelectorAll('button')].find((b) => b.textContent.includes('Wrong home')));
    await wrong.asElement().focus();
    await page.keyboard.press('Enter');
    const inputFocused = await page.evaluate(() => document.getElementById('mbx-root').shadowRoot.activeElement?.tagName);
    check(inputFocused === 'INPUT', '"Wrong home?" reveals and focuses the address input');
    await page.screenshot({ path: path.join(shotsDir, 'preview-ok-wronghome.png') });

    await page.keyboard.press('Escape');
    const collapsed = await page.evaluate(() => {
      const r = document.getElementById('mbx-root').shadowRoot;
      return { panelHidden: r.querySelector('.panel').hidden, pillShown: !r.querySelector('.pill').hidden, focus: r.activeElement?.className };
    });
    check(collapsed.panelHidden && collapsed.pillShown, 'Esc collapses the panel to the pill');
    check(collapsed.focus === 'pill', 'focus moves to the pill after Esc');
    await page.screenshot({ path: path.join(shotsDir, 'preview-esc-collapsed.png'), clip: { x: 1440 - 400, y: 70, width: 400, height: 80 } });
    await page.keyboard.press('Enter');
    const expanded = await page.evaluate(() => !document.getElementById('mbx-root').shadowRoot.querySelector('.panel').hidden);
    check(expanded, 'Enter on the pill expands the panel');
    await page.close();
  }

  // Form: Enter submits the typed address and switches the preview to loading (input disabled).
  {
    const page = await open('need_address', 1440, 900);
    const logs = [];
    page.on('console', (m) => logs.push(m.text()));
    await page.locator('#mbx-root input').fill('26 Tudor Street, Surry Hills NSW 2010');
    await page.locator('#mbx-root input').press('Enter');
    await page.waitForTimeout(100);
    const st = await page.evaluate(() => document.getElementById('mbx-root').getAttribute('data-mbx-state'));
    const disabled = await page.evaluate(() => document.getElementById('mbx-root').shadowRoot.querySelector('input')?.disabled);
    check(st === 'loading', `Enter in the address input submits (state=${st})`);
    check(disabled === true, 'address input is disabled while loading');
    check(logs.some((l) => l.includes('onSubmitAddress')), 'onSubmitAddress was called');
    await page.screenshot({ path: path.join(shotsDir, 'preview-typed-loading.png') });
    // empty submit is refused
    await page.close();
    const p2 = await open('need_address', 1440, 900);
    await p2.locator('#mbx-root input').press('Enter');
    const invalid = await p2.evaluate(() => document.getElementById('mbx-root').shadowRoot.querySelector('input').getAttribute('aria-invalid'));
    check(invalid === 'true', 'empty submit is refused with a hint');
    await p2.close();
  }

  // Bottom of #ok at 1280x720: DA section with the "More" toggle expanded, footer still pinned.
  {
    const page = await open('ok', 1280, 720);
    const more = page.locator('#mbx-root button', { hasText: 'More' });
    check(await more.isVisible(), 'DA "More" toggle shows for a long description');
    await more.click();
    await page.evaluate(() => { const b = document.getElementById('mbx-root').shadowRoot.querySelector('.body'); b.scrollTop = b.scrollHeight; });
    check((await page.locator('#mbx-root button', { hasText: 'Less' }).count()) === 1, '"More" toggles to "Less"');
    await page.screenshot({ path: path.join(shotsDir, 'preview-ok-bottom-1280x720.png') });
    await page.close();
  }

  // Close button calls onClose and the preview destroys the panel.
  {
    const page = await open('ok', 1440, 900);
    await page.locator('#mbx-root button[aria-label="Close Listing Check"]').click();
    const gone = await page.evaluate(() => !document.getElementById('mbx-root'));
    check(gone, 'close removes #mbx-root');
    await page.close();
  }
} finally {
  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

if (problems.length) {
  console.error('\nPROBLEMS:\n' + problems.map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}
console.log('\nall states rendered, no console/page errors, keyboard + form checks passed');
