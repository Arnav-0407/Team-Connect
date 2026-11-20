const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync('js/sidebarResize.js', 'utf8');
function boot(savedWidth, failStorage = false) {
  let viewportWidth = 1200;
  let sidebarWidth = 250;
  const listeners = {};
  const attributes = {};
  const classes = new Set();
  const saved = new Map(savedWidth ? [['teamconnect.sidebar-width.v1', savedWidth]] : []);
  let captured = null;
  const divider = {
    addEventListener: (name, handler) => { listeners[name] = handler; },
    setAttribute: (name, value) => { attributes[name] = value; },
    getAttribute: (name) => attributes[name], focus() {},
    setPointerCapture: (pointerId) => { captured = pointerId; },
    hasPointerCapture: (pointerId) => captured === pointerId,
    releasePointerCapture: () => { captured = null; }
  };
  const workspace = {
    getBoundingClientRect: () => ({ width: viewportWidth }),
    style: { setProperty: (name, value) => { sidebarWidth = parseFloat(value); } },
    classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) }
  };
  const elements = { '.workspace': workspace, '#sidebar': { getBoundingClientRect: () => ({width:sidebarWidth}) }, '#sidebar-resizer': divider };
  vm.runInNewContext(source, {
    document: { querySelector: (selector) => elements[selector] },
    localStorage: { getItem: key => { if (failStorage) throw Error(); return saved.get(key) ?? null; }, setItem: (key, value) => { if (failStorage) throw Error(); saved.set(key, value); } },
    window: { addEventListener: (name, handler) => { listeners[name] = handler; } }
  });
  return {
    width: () => sidebarWidth, saved, classes, attributes,
    fire: (name, data = {}) => listeners[name]({ preventDefault() {}, button:0, pointerId:1, ...data }),
    resize(width) { viewportWidth = width; listeners.resize(); }
  };
}
test('dragging changes sidebar width, clamps it, saves it, and releases the drag', () => {
  const app = boot();
  app.fire('pointerdown', {clientX:250});
  app.fire('pointermove', {clientX:350});
  assert.equal(app.width(), 350);
  app.fire('pointermove', {clientX:1000});
  assert.equal(app.width(), 480);
  app.fire('pointerup');
  assert.equal(app.classes.has('resizing'), false);
  assert.equal(app.saved.get('teamconnect.sidebar-width.v1'), '480');
  app.fire('pointermove', {clientX:220});
  assert.equal(app.width(), 480);
});
test('keyboard resizing, viewport bounds, and double-click reset work', () => {
  const app = boot('320');
  assert.equal(app.width(), 320);
  app.fire('keydown', {key:'ArrowRight'});
  assert.equal(app.width(), 330);
  app.fire('keydown', {key:'ArrowLeft', shiftKey:true});
  assert.equal(app.width(), 290);
  app.fire('keydown', {key:'Home'});
  assert.equal(app.width(), 200);
  app.fire('keydown', {key:'End'});
  app.resize(800);
  assert.equal(app.width(), 434);
  assert.equal(app.attributes['aria-valuenow'], '434');
  app.resize(1200);
  assert.equal(app.width(), 480);
  app.fire('dblclick');
  assert.equal(app.width(), 250);
});
test('cancelled drags finish cleanly and unavailable storage does not prevent resizing', () => {
  const app = boot(null, true);
  app.fire('pointerdown', {clientX:250});
  app.fire('pointermove', {clientX:100});
  assert.equal(app.width(), 200);
  app.fire('pointercancel');
  assert.equal(app.classes.has('resizing'), false);
  app.fire('keydown', {key:'ArrowRight'});
  assert.equal(app.width(), 210);
});
