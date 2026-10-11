'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = path.join(__dirname, '../station/frontend/app');
const windowStub = { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
const documentStub = { addEventListener() {}, documentElement: { style: { setProperty() {} } } };
global.U = new Function('window', 'document', fs.readFileSync(path.join(app, '../js/util.js'), 'utf8') + '; return U;')(windowStub, documentStub);
const P = require(path.join(app, 'propsprites.js'));
const M = require(path.join(app, 'worldmodel.js'));
const T = require(path.join(app, 'stationtemplates.js'));

function frame(at, tx = 3, ty = 4) {
  const pixels = new Map();
  const ctx = {
    fillStyle: '', globalAlpha: 1,
    fillRect(x, y, w, h) {
      assert.ok([x, y, w, h].every(Number.isInteger), 'cat pixels stay on the pixel grid');
      assert.ok(w > 0 && h > 0);
      assert.ok(x >= tx * P.TILE && y >= ty * P.TILE && x + w <= (tx + 1) * P.TILE && y + h <= (ty + 1) * P.TILE,
        `rectangle ${[x, y, w, h]} escapes tile ${[tx, ty]} at ${at}ms`);
      for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
        pixels.set(`${px - tx * P.TILE},${py - ty * P.TILE}`, [this.fillStyle, this.globalAlpha]);
      }
    }
  };
  P.setCtx(ctx); P.setNow(at);
  P.draw({ t: 'ultra_cat', x: tx, y: ty, w: 1, h: 1 }, false);
  assert.ok(pixels.size > 20, 'the cat paints a visible body');
  return JSON.stringify([...pixels].sort(([a], [b]) => a.localeCompare(b)));
}

test('ultra_cat has the exact cosmetic catalog row and its own cat interaction', () => {
  assert.deepEqual(P.spec('ultra_cat'), {
    id: 'ultra_cat', label: 'STATION CAT', cat: 'decor', tier: 'cosmetic', w: 1, h: 1,
    animated: true, blocks: false,
    desc: 'A ginger station cat. The crew stop by to pet it. Decoration only.',
    use: { kind: 'cat', sit: false, approach: 'auto' }
  });
  assert.equal(P.has('ultra_cat'), true);
  assert.equal(P.CATALOG.filter(p => p.id === 'ultra_cat').length, 1);
  const holo = P.CATALOG.findIndex(p => p.id === 'holopet');
  assert.equal(P.CATALOG[holo + 1].id, 'ultra_cat', 'the cat sits next to holopet in BUILD');
});

test('drawing ultra_cat only touches pixels inside its 12 by 12 tile at every sampled time and origin', () => {
  for (const tx of [-17, 0, 3, 12]) for (const ty of [-2, 0, 8]) {
    for (const at of [0, 100, 350, 900, 1700, 2400, 4800, 10000]) frame(at, tx, ty);
  }
});

test('ultra_cat animates over time and uses the per-prop phase', () => {
  const frames = Array.from({ length: 101 }, (_, i) => frame(i * 100));
  assert.ok(new Set(frames).size > 2, 'blinking, breathing and tail motion change painted pixels');
  assert.notEqual(frame(350, 0), frame(350, 1), 'cats at different x tiles have different animation phases');
});

test('the cat breathes by one pixel every couple of seconds', () => {
  const tops = Array.from({ length: 61 }, (_, i) => {
    const pixels = JSON.parse(frame(i * 100, 0, 0));
    return Math.min(...pixels.map(([point]) => Number(point.split(',')[1])));
  });
  assert.equal(Math.max(...tops) - Math.min(...tops), 1, 'breathing moves the silhouette by exactly one pixel');
  const rises = tops.flatMap((top, i) => i && top < tops[i - 1] ? [i * 100] : []);
  assert.ok(rises.length >= 2, 'the cat takes more than one breath in six seconds');
  assert.ok(rises.slice(1).every((at, i) => at - rises[i] <= 3000), 'successive breaths stay within three seconds');
});

test('the 1ULTRA COMMAND build has exactly one cat at COMMAND tile 12,8 with no overlap', () => {
  const st = M.create(T.build('ultra-command', M, P));
  const cats = st.props().filter(p => p.t === 'ultra_cat');
  assert.equal(cats.length, 1);
  const cat = cats[0], room = st.roomById(st.roomAt(cat.x, cat.y));
  assert.equal(room.name, 'COMMAND');
  assert.deepEqual([cat.x - room.rects[0].x1, cat.y - room.rects[0].y1, cat.w, cat.h, cat.block], [12, 8, 1, 1, false]);
  assert.ok(st.props().filter(p => p.id !== cat.id).every(p =>
    p.x + p.w <= cat.x || cat.x + cat.w <= p.x || p.y + p.h <= cat.y || cat.y + cat.h <= p.y), 'the preset leaves the cat tile free');
});

test('cat speech is grounded in a real cat and its idle beat follows pet tracking', () => {
  const source = fs.readFileSync(path.join(app, 'world.js'), 'utf8');
  const tables = {};
  for (const name of ['USE_LINE', 'USE_BEAT']) {
    const literal = source.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\n  \\});`));
    assert.ok(literal, `${name} is available`);
    tables[name] = vm.runInNewContext(`(${literal[1]})`);
  }
  assert.deepEqual(Array.from(tables.USE_LINE.cat || []), ['it purrs at me', 'soft, and unbothered', 'it chose this tile', 'hello, cat']);
  assert.deepEqual(JSON.parse(JSON.stringify(tables.USE_BEAT.cat || null)), JSON.parse(JSON.stringify(tables.USE_BEAT.pet)));
  assert.equal(tables.USE_BEAT.cat.track, true);
});
