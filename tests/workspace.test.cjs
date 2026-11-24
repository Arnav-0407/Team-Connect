const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const sources = ["js/data/cloudWorkspace.js", "js/adminSettings.js", "js/app.js"]
  .map(file => readFileSync(file, "utf8"));
const workspaceKey = "teamconnect.workspace.v1";
const adminId = "user-arnav";
const arnavId = "employee-arnav";
const parthId = "employee-parth";

function localHistory() {
  const messages = [{
    id: "message-1", authorId: adminId, authorName: "Admin",
    text: "Existing history", createdAt: "2026-11-24T08:00:00Z"
  }];
  const channels = [
    { id: "general", name: "general", messages, draft: "" },
    { id: "planning", name: "planning", messages: [], draft: "" }
  ];
  return { version: 1, defaultsRemoved: true, activeServerId: "server", servers: [
    { id: "server", name: "TeamConnect", channels, activeChannelId: "general" }
  ] };
}

function boot({ saved = new Map([[workspaceKey, JSON.stringify(localHistory())]]), failWrites = false, sdk } = {}) {
  class Element {
    constructor() {
      this.children = [];
      this.listeners = {};
      this.attributes = {};
      this.value = "";
      this.textContent = "";
      this.classes = new Set();
      this.style = {};
      this.dataset = {};
      this.files = [];
      this.hidden = true;
      this.open = false;
      this.scrollTop = 0;
      this.scrollHeight = 0;
      this.clientHeight = 0;
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attributes[key] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    remove() {}
    addEventListener(key, fn) { this.listeners[key] = fn; }
    fire(key, extra = {}) {
      this.lastEvent = this.listeners[key]?.({ preventDefault() {}, ...extra });
      return this.lastEvent;
    }
    focus() {}
    reset() {}
    getClientRects() { return []; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    requestSubmit() { return this.fire("submit"); }
    querySelector() { return this.button ||= new Element(); }
    querySelectorAll() { return []; }
    get classList() {
      return {
        contains: value => this.classes.has(value),
        remove: value => this.classes.delete(value),
        toggle: value => this.classes.has(value) ? (this.classes.delete(value), false) : (this.classes.add(value), true)
      };
    }
  }
  const elements = {};
  const document = {
    documentElement: new Element(),
    querySelector: selector => elements[selector] ||= new Element(),
    querySelectorAll: () => [],
    createElement: () => new Element(),
    addEventListener() {}
  };
  let blockWrites = false;
  const storage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => {
      if (blockWrites) throw Error("Storage full");
      saved.set(key, value);
    }
  };
  const context = vm.createContext({
    document, localStorage: storage,
    sessionStorage: { getItem: () => adminId, setItem() {} },
    window: { addEventListener() {}, confirm: () => true },
    crypto: require("node:crypto").webcrypto,
    structuredClone, URL, setTimeout, clearTimeout, setInterval() {},
    teamConnectConfig: sdk && { backend: "sqlite" },
    teamConnectTestBackend: sdk
  });
  sources.forEach(source => vm.runInContext(source, context));
  blockWrites = failWrites;
  const run = code => vm.runInContext(code, context);
  return {
    elements, saved, run,
    click: selector => document.querySelector(selector).fire("click"),
    async create(mode, name) {
      await this.click(mode === "server" ? "#add-server" : "#add-channel");
      elements["#entity-name"].value = name;
      await elements["#create-form"].fire("submit");
    },
    type(value) {
      elements["#message-input"].value = value;
      elements["#message-input"].fire("input");
    },
    async send(value) {
      this.type(value);
      await elements["#message-form"].fire("submit");
    },
    state: () => sdk ? JSON.parse(run("JSON.stringify(state)")) : JSON.parse(saved.get(workspaceKey))
  };
}

test("servers isolate history and drafts and restore the selected channel locally", async () => {
  const app = boot();
  app.type("Original draft");
  await app.create("server", "Website redesign");
  assert.equal(app.state().servers.length, 2);
  assert.deepEqual(app.state().servers[1].channels, []);
  await app.create("channel", "planning");
  await app.send("Project-specific update");
  app.type("Planning draft");
  await app.elements["#server-list"].children[0].fire("click");
  assert.equal(app.elements["#message-input"].value, "Original draft");
  assert.equal(app.state().servers[0].channels[0].messages.length, 1);
  await app.elements["#server-list"].children[1].fire("click");
  assert.equal(app.elements["#composer-label"].textContent, "#planning");
  const reloaded = boot({ saved: app.saved });
  assert.equal(reloaded.elements["#message-input"].value, "Planning draft");
  assert.equal(reloaded.state().servers[1].channels[0].messages[0].text, "Project-specific update");
});

test("custom channels normalize names, reject duplicates and invalid names, and isolate messages", async () => {
  const app = boot();
  await app.create("channel", "Design Feedback");
  assert.equal(app.elements["#composer-label"].textContent, "#design-feedback");
  await app.send("<script>alert('hello')</script>");
  assert.equal(app.state().servers[0].channels[2].messages[0].text, "<script>alert('hello')</script>");
  await app.create("channel", "Design Feedback");
  assert.match(app.elements["#dialog-error"].textContent, /already exists/);
  await app.create("channel", "---");
  assert.match(app.elements["#dialog-error"].textContent, /letters, numbers, and single hyphens/);
  assert.equal(app.state().servers[0].channels[0].messages.length, 1);
});

test("keeps existing workspace history while removing built-in sample messages", () => {
  const history = localHistory();
  history.defaultsRemoved = false;
  history.servers[0].channels[0].messages.push({
    id: "sample-2", authorId: adminId, authorName: "Admin",
    text: "Sample message", createdAt: "2026-11-24T10:00:00Z"
  });
  const app = boot({ saved: new Map([[workspaceKey, JSON.stringify(history)]]) });
  assert.deepEqual(app.state().servers[0].channels[0].messages.map(message => message.text), ["Existing history"]);
});

test("keeps malformed saved data intact and disables writes", () => {
  const saved = new Map([[workspaceKey, "{broken"]]);
  const app = boot({ saved });
  assert.equal(app.saved.get(workspaceKey), "{broken");
  assert.equal(app.elements["#message-input"].disabled, true);
  assert.match(app.elements["#workspace-error"].textContent, /stored data has been kept/);
});

test("storage failures preserve messages and unsent input", async () => {
  const broken = boot({ failWrites: true });
  await broken.send("Keep my text");
  assert.equal(broken.elements["#message-input"].value, "Keep my text");
  assert.equal(broken.state().servers[0].channels[0].messages.length, 1);
  assert.match(broken.elements["#workspace-error"].textContent, /could not be saved/);
});

test("keyboard sends messages and mobile navigation opens and closes", async () => {
  const app = boot();
  app.type("Keyboard message");
  app.elements["#message-input"].fire("keydown", { key: "Enter", shiftKey: false, isComposing: false });
  await app.elements["#message-form"].lastEvent;
  assert.equal(app.state().servers[0].channels[0].messages.at(-1).text, "Keyboard message");
  await app.click("#menu-button");
  assert.equal(app.elements["#menu-button"].attributes["aria-expanded"], "true");
  await app.elements["#channel-list"].children[1].fire("click");
  assert.equal(app.elements["#menu-button"].attributes["aria-expanded"], "false");
});

function fakeBackend() {
  const accounts = {
    [adminId]: { name: "Admin", email: "admin@example.test", role: "Workspace Admin" },
    [arnavId]: { name: "Arnav", email: "arnav@example.test", role: "Employee" },
    [parthId]: { name: "Parth", email: "", role: "Employee" }
  };
  const records = new Map();
  const callbacks = new Set();
  let revision = 0;
  let loseResponse = false;
  return {
    loseResponse() { loseResponse = true; },
    sdk(account) {
      return {
        getSession: async () => ({ user: { id: account } }),
        onAuthChange() {},
        snapshot: async () => ({
          account, accounts, revision,
          records: structuredClone([...records.values()].filter(record => record.kind !== "draft" || record.data.owner === account))
        }),
        commit: async changes => {
          for (const { kind, id, after } of changes) {
            const key = kind + ":" + id;
            if (after) records.set(key, { kind, id, data: structuredClone(after) });
            else records.delete(key);
          }
          revision += 1;
          callbacks.forEach(refresh => refresh());
          if (loseResponse) {
            loseResponse = false;
            throw new Error("Connection dropped after commit");
          }
        },
        revision: async () => revision,
        subscribe(_id, refresh) {
          callbacks.add(refresh);
          refresh();
          return () => callbacks.delete(refresh);
        }
      };
    }
  };
}

const pendingUi = () => new Promise(resolve => setImmediate(resolve));

test("cloud browsers exchange messages, retain local draft input, and reload saved history", async () => {
  const backend = fakeBackend();
  const admin = boot({ sdk: backend.sdk(adminId) });
  await pendingUi();
  await admin.create("server", "Launch");
  await admin.create("channel", "general");
  admin.run("openAddMember(activeServer().id)");
  admin.elements["#member-email"].value = "arnav@example.test";
  await admin.elements["#add-member-form"].fire("submit");
  const employee = boot({ sdk: backend.sdk(arnavId) });
  await pendingUi();

  employee.type("Still typing");
  await admin.send("Hello from Chrome");
  await pendingUi();
  assert.equal(employee.state().servers[0].channels[0].messages[0].text, "Hello from Chrome");
  assert.equal(employee.elements["#message-input"].value, "Still typing");
  await employee.send("Hello from Firefox");
  await pendingUi();
  assert.deepEqual(admin.state().servers[0].channels[0].messages.map(message => message.text).sort(),
    ["Hello from Chrome", "Hello from Firefox"]);

  const fresh = boot({ sdk: backend.sdk(arnavId), saved: new Map() });
  await pendingUi();
  assert.equal(fresh.state().servers[0].channels[0].messages.length, 2);
  assert.equal(fresh.saved.has(workspaceKey), false);
});

test("retrying a send after a lost acknowledgement does not duplicate the message", async () => {
  const backend = fakeBackend();
  const app = boot({ sdk: backend.sdk(adminId) });
  await pendingUi();
  await app.create("server", "Launch");
  await app.create("channel", "general");
  backend.loseResponse();
  await app.send("Only once");
  assert.equal(app.elements["#message-input"].value, "Only once");
  await app.elements["#message-form"].fire("submit");
  await pendingUi();
  assert.equal(app.state().servers[0].channels[0].messages.length, 1);
  assert.equal(app.elements["#message-input"].value, "");
});
