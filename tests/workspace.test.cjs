const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync('js/app.js', 'utf8');

// Minimal DOM adapter: exercise the real event handlers and storage without a browser.
function boot(saved = new Map(), failWrites = false) {
  class Element {
    constructor() { this.children = []; this.listeners = {}; this.attributes = {}; this.value = ''; this.textContent = ''; this.classes = new Set(); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(key, fn) { this.listeners[key] = fn; }
    fire(key, extra = {}) { this.listeners[key]?.({ preventDefault() {}, ...extra }); }
    focus() {}
    reset() { document.querySelector('#entity-name').value = ''; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    requestSubmit() { this.fire('submit'); }
    querySelector() { return this.button ||= new Element(); }
    get classList() { return { contains: (v) => this.classes.has(v), remove: (v) => this.classes.delete(v), toggle: (v) => this.classes.has(v) ? (this.classes.delete(v), false) : (this.classes.add(v), true) }; }
  }
  const elements = {};
  const document = {
    querySelector: (selector) => elements[selector] ||= new Element(),
    createElement: () => new Element(), addEventListener() {}
  };
  const storage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => { if (failWrites) throw Error('Storage full'); saved.set(key, value); } };
  const context = vm.createContext({ document, localStorage: storage, window: { addEventListener() {} }, crypto: require('node:crypto').webcrypto });
  vm.runInContext(source, context);
  return {
    elements, saved,
    click: (selector) => elements[selector].fire('click'),
    create(mode, name) { elements[mode === 'server' ? '#add-server' : '#add-channel'].fire('click'); elements['#entity-name'].value = name; elements['#create-form'].fire('submit'); },
    type(value) { elements['#message-input'].value = value; elements['#message-input'].fire('input'); },
    send(value) { this.type(value); elements['#message-form'].fire('submit'); },
    state: () => JSON.parse(saved.get('teamconnect.workspace.v1')),
    run: (code) => vm.runInContext(code, context)
  };
}

test('servers isolate messages and drafts, restore selected channel, and persist on reload', () => {
  const app = boot();
  const original = app.state().servers[0];
  app.type('Original draft');
  app.create('server', 'Website redesign');
  let state = app.state();
  assert.equal(state.servers.length, 2);
  assert.deepEqual(state.servers[1].channels.map(c => c.name), ['general', 'planning', 'resources']);
  assert.equal(app.elements['#message-input'].value, '');
  app.send('Project-specific update');
  app.elements['#channel-list'].children[1].fire('click');
  app.type('Planning draft');
  app.elements['#server-list'].children[0].fire('click');
  assert.equal(app.elements['#message-input'].value, 'Original draft');
  assert.equal(app.state().servers[0].channels[0].messages.length, 2);
  app.elements['#server-list'].children[1].fire('click');
  assert.equal(app.elements['#channel-title'].textContent, 'planning');
  assert.equal(app.elements['#message-input'].value, 'Planning draft');
  const reloaded = boot(app.saved);
  assert.equal(reloaded.elements['#message-input'].value, 'Planning draft');
  assert.equal(reloaded.state().servers[1].channels[0].messages[0].text, 'Project-specific update');
  assert.equal(reloaded.state().servers[0].id, original.id);
});

test('custom channels normalize names, reject duplicates and invalid names, and isolate messages', () => {
  const app = boot();
  app.create('channel', 'Design Feedback');
  assert.equal(app.elements['#channel-title'].textContent, 'design-feedback');
  app.send('<script>alert("hello")</script>');
  assert.equal(app.state().servers[0].channels[3].messages[0].text, '<script>alert("hello")</script>');
  app.create('channel', 'Design Feedback');
  assert.match(app.elements['#dialog-error'].textContent, /already exists/);
  app.create('channel', '---');
  assert.match(app.elements['#dialog-error'].textContent, /single hyphens/);
  app.create('server', 'teamconnect');
  assert.match(app.elements['#dialog-error'].textContent, /already exists/);
  assert.equal(app.state().servers.length, 1);
  assert.equal(app.state().servers[0].channels[0].messages.length, 2);
});

test('migrates the old General chat without deleting the original data', () => {
  const legacy = JSON.stringify([{ id:'old', authorId:'user-arnav', authorName:'Arnav', text:'Existing message', createdAt:'2026-11-12T09:00:00Z' }]);
  const saved = new Map([['teamconnect.general.messages.v1', legacy]]);
  const app = boot(saved);
  assert.equal(app.state().servers[0].channels[0].messages[0].text, 'Existing message');
  assert.equal(saved.get('teamconnect.general.messages.v1'), legacy);
});

test('keeps malformed saved data intact and disables writes', () => {
  const saved = new Map([['teamconnect.workspace.v1', '{broken']]);
  const app = boot(saved);
  assert.equal(saved.get('teamconnect.workspace.v1'), '{broken');
  assert.equal(app.elements['#message-input'].disabled, true);
  assert.match(app.elements['#workspace-error'].textContent, /stored data has been kept/);
});

test('storage failures preserve messages and unsent input', () => {
  const app = boot();
  const broken = boot(app.saved, true);
  broken.send('Keep my text');
  assert.equal(broken.elements['#message-input'].value, 'Keep my text');
  assert.equal(broken.state().servers[0].channels[0].messages.length, 2);
  assert.match(broken.elements['#workspace-error'].textContent, /could not be saved/);
});

test('keyboard sends messages and mobile navigation opens and closes', () => {
  const app = boot();
  app.type('Keyboard message');
  app.elements['#message-input'].fire('keydown', {key:'Enter', shiftKey:false, isComposing:false});
  assert.equal(app.state().servers[0].channels[0].messages.at(-1).text, 'Keyboard message');
  app.click('#menu-button');
  assert.equal(app.elements['#menu-button'].attributes['aria-expanded'], 'true');
  app.elements['#channel-list'].children[1].fire('click');
  assert.equal(app.elements['#menu-button'].attributes['aria-expanded'], 'false');
});
