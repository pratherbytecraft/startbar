// The renderer's shared helpers that are plain functions: color schemes,
// light or dark and the accent color, and the clock text.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('../support/renderer');

const window = load('schemes.js', 'theme.js', 'clock.js');
const { schemeVars, schemes, resolveTheme, ACCENTS, clockText, dateText } = window;
const LIGHT = { accent: '#007aff', appearance: 'light' };
const DARK = { accent: '#0a84ff', appearance: 'dark' };
const vars = (theme, colors, look = LIGHT) => plain(schemeVars({ theme, colors }, look));
const filled = (v) => Object.values(v).every((x) => typeof x === 'string' && x.length > 0);

test('the System theme takes no scheme variables', () => {
  assert.deepEqual(vars('system', { scheme: 'default' }), {});
});

test('every Classic 2001 scheme sets every variable', () => {
  const sizes = new Set();
  for (const scheme of [...schemes.XP, 'system']) {
    for (const look of [LIGHT, DARK]) {
      const v = vars('classic-2001', { scheme }, look);
      assert.ok(filled(v), `${scheme} ${look.appearance}`);
      sizes.add(Object.keys(v).length);
    }
  }
  assert.equal(sizes.size, 1, 'the same variables for each scheme');
});

test('Classic 2001 System uses the accent color, an unknown scheme falls back to blue', () => {
  assert.equal(vars('classic-2001', { scheme: 'system' })['--xp-act2'], LIGHT.accent);
  assert.deepEqual(vars('classic-2001', { scheme: 'nope' }), vars('classic-2001', { scheme: 'blue' }));
});

test('every Classic 1995 scheme sets every variable with readable text', () => {
  for (const scheme of [...Object.keys(schemes.W95), 'system']) {
    const v = vars('classic-1995', { scheme });
    assert.ok(filled(v), scheme);
    assert.equal(Object.keys(v).length, 14, scheme);
  }
  assert.equal(vars('classic-1995', { scheme: 'standard' })['--text95'], '#000000');
  assert.equal(vars('classic-1995', { scheme: 'contrast' })['--text95'], '#ffffff', 'a black face gets white text');
  assert.equal(vars('classic-1995', { scheme: 'standard' })['--sel-text'], '#ffffff');
});

test('Classic 1995 Custom uses its own four colors', () => {
  const v = vars('classic-1995', { scheme: 'custom', face: '#112233', selected: '#445566', title1: '#778899', title2: '#aabbcc' });
  assert.equal(v['--face'], '#112233');
  assert.equal(v['--navy'], '#445566');
  assert.equal(v['--title1'], '#778899');
  assert.equal(v['--title2'], '#aabbcc');
  assert.equal(v['--field'], '#000000', 'a dark face gets dark fields');
});

test('Classic 2009 glass takes its color, the accent for System, the tint for Custom', () => {
  assert.equal(vars('classic-2009', { scheme: 'sky', intensity: 50 })['--tint'], '#4a9ff5');
  assert.equal(vars('classic-2009', { scheme: 'sky', intensity: 50 })['--strength'], '50%');
  assert.equal(vars('classic-2009', { scheme: 'system' })['--tint'], LIGHT.accent);
  assert.equal(vars('classic-2009', { scheme: 'custom', tint: '#123456' })['--tint'], '#123456');
  assert.equal(vars('classic-2009', { scheme: 'sky', intensity: 'x' })['--strength'], '34%', 'a bad strength falls back');
});

test('mix goes from one color to the other', () => {
  assert.equal(schemes.mix('#000000', '#ffffff', 0), '#000000');
  assert.equal(schemes.mix('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(schemes.mix('#000000', '#ffffff', 0.5), '#808080');
});

test('colors come back from hue, saturation and lightness, give or take rounding', () => {
  const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (const hex of ['#4a9ff5', '#c8343b', '#808080', '#000000', '#ffffff']) {
    const back = channels(schemes.fromHsl(schemes.toHsl(hex)));
    channels(hex).forEach((v, i) => assert.ok(Math.abs(v - back[i]) <= 3, `${hex} came back as ${back}`));
  }
});

test('Follow Mac takes the Mac look, a picked accent has a light and a dark shade', () => {
  const system = { appearance: 'dark', accent: '#ff9f0a' };
  let r = plain(resolveTheme({ settings: { appearance: 'auto', accent: 'auto' }, system }));
  assert.equal(r.appearance, 'dark');
  assert.equal(r.accent, '#ff9f0a');
  r = plain(resolveTheme({ settings: { appearance: 'light', accent: 'green' }, system }));
  assert.equal(r.appearance, 'light');
  assert.equal(r.accent, ACCENTS.green[0]);
  r = plain(resolveTheme({ settings: { appearance: 'dark', accent: 'green' }, system }));
  assert.equal(r.accent, ACCENTS.green[1]);
  assert.equal(r.accentText, '#ffffff');
  assert.equal(plain(resolveTheme({ settings: { appearance: 'light', accent: 'yellow' }, system })).accentText, '#1d1d1f', 'dark text on yellow');
});

test('the clock shows 12 or 24 hour time, with seconds when asked', () => {
  const d = new Date(2026, 9, 18, 14, 5, 9);
  const twelve = clockText(d, { hour12: true, seconds: false, dateStyle: 'short' });
  assert.match(twelve.time, /2:05\s?PM/i);
  const full = clockText(d, { hour12: false, seconds: true, dateStyle: 'short' });
  assert.match(full.time, /14:05:09/);
  assert.match(twelve.full, /2026/);
});

test('each date style', () => {
  const d = new Date(2026, 9, 18);
  assert.equal(dateText(d, 'dayFirst'), '18 Oct');
  assert.match(dateText(d, 'short'), /18/);
  assert.match(dateText(d, 'numeric'), /26/);
  assert.notEqual(dateText(d, 'weekday'), dateText(d, 'short'));
});
