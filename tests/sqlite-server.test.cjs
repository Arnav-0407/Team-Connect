const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { once } = require("node:events");
const { openDatabase, accounts } = require("../server/database.cjs");
const { backendConfig, createTeamConnectServer } = require("../server/index.cjs");

const [admin, arnav, parth] = accounts;
const change = (kind, id, after, before = null) => ({ kind, id, before, after });
const time = "2026-11-24T10:00:00.000Z";
const message = (person, text) => ({
  authorId: person.id, authorName: person.name, text, serverId: "launch", channelId: "general", createdAt: time
});
const testPassword = "sqlite-test-password";

test("SQLite serves live updates and keeps authorized chat history across a restart", async t => {
  const dir = await mkdtemp(join(tmpdir(), "team-connect-test-"));
  const filename = join(dir, "workspace.sqlite");
  const db = openDatabase(filename);
  try {
    for (const person of accounts) await db.setPassword(person.id, testPassword);
  } finally {
    db.close();
  }
  let server;
  let origin;
  async function start() {
    server = createTeamConnectServer({ filename });
    const ready = once(server, "listening");
    server.listen(0, "127.0.0.1");
    await ready;
    origin = "http://127.0.0.1:" + server.address().port;
  }
  async function stop() {
    if (!server?.listening) return;
    const closed = once(server, "close");
    server.closeLiveStreams();
    server.close();
    await closed;
  }
  t.after(async () => {
    await stop();
    await rm(dir, { recursive: true, force: true });
  });
  await start();

  async function call(path, { cookie, body, requestOrigin } = {}) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (requestOrigin) headers.Origin = requestOrigin;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(origin + path, {
      method: body === undefined ? "GET" : "POST", headers, body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000)
    });
    return response;
  }

  async function login(person) {
    const response = await call("/api/sign-in", { body: { email: person.email, password: testPassword } });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly; SameSite=Lax/);
    assert.equal((await response.json()).session.user.id, person.id);
    return cookie.split(";")[0];
  }

  const commit = (cookie, ...changes) => call("/api/changes", { cookie, body: { changes } });
  const snapshot = async cookie => (await call("/api/workspace", { cookie })).json();
  const config = await call("/js/backendConfig.js");
  assert.match(await config.text(), /"backend":"sqlite"/);
  assert.equal((await call("/.data/team-connect.sqlite")).status, 404);
  assert.equal((await call("/api/workspace")).status, 401);
  assert.equal((await call("/api/sign-in", { requestOrigin: "https://other.example", body: {} })).status, 403);
  assert.equal((await call("/api/sign-in", { body: { email: admin.email, password: "wrong" } })).status, 401);
  const adminCookie = await login(admin);
  const employeeCookie = await login(arnav);
  const otherCookie = await login(parth);
  const project = { name: "Launch", memberIds: [admin.id, arnav.id] };
  const channel = { name: "general", serverId: "launch", archived: false };
  assert.equal((await commit(adminCookie, change("server", "launch", project), change("channel", "general", channel))).status, 200);
  assert.equal((await snapshot(otherCookie)).records.length, 0);
  assert.equal((await commit(otherCookie, change("message", "forbidden", message(parth, "No access")))).status, 403);

  const live = await call("/api/live", { cookie: employeeCookie });
  assert.match(live.headers.get("content-type"), /text\/event-stream/);
  const stream = live.body.getReader();
  const decode = new TextDecoder();
  assert.match(decode.decode((await stream.read()).value), /data: \d+/);

  const employeeMessage = message(arnav, "Hello @Admin");
  const adminMessage = message(admin, "Hello from Admin");
  const results = await Promise.all([
    commit(adminCookie, change("message", "admin", adminMessage)),
    commit(employeeCookie, change("message", "arnav", employeeMessage))
  ]);
  assert.deepEqual(results.map(response => response.status), [200, 200]);
  assert.match(decode.decode((await stream.read()).value), /data: \d+/);
  assert.equal((await snapshot(adminCookie)).records.filter(record => record.kind === "message").length, 2);
  assert.equal((await snapshot(adminCookie)).records.some(record => record.kind === "event"), true);

  const draft = { text: "private draft", owner: arnav.id, channelId: "general", serverId: "launch" };
  assert.equal((await commit(employeeCookie, change("draft", arnav.id + ":general", draft))).status, 200);
  assert.equal((await snapshot(adminCookie)).records.some(record => record.kind === "draft"), false);
  assert.equal((await snapshot(employeeCookie)).records.some(record => record.kind === "draft"), true);
  assert.equal((await commit(employeeCookie, change("message", "admin", { ...adminMessage, text: "Forged" }, adminMessage))).status, 403);
  const edited = { ...employeeMessage, text: "Edited", editedAt: time };
  assert.equal((await commit(employeeCookie, change("message", "arnav", edited, employeeMessage))).status, 200);
  assert.equal((await commit(employeeCookie, change("message", "arnav", { ...edited, text: "Stale edit" }, employeeMessage))).status, 409);
  await stream.cancel();

  await stop();
  await start();
  const freshCookie = await login(arnav);
  const saved = (await snapshot(freshCookie)).records;
  assert.deepEqual(saved.find(record => record.id === "arnav").data, edited);
  assert.equal(saved.find(record => record.kind === "draft").data.text, draft.text);
  assert.equal((await commit(adminCookie, change("server", "launch", { ...project, memberIds: [admin.id] }, project))).status, 200);
  assert.deepEqual((await snapshot(freshCookie)).records, []);
  assert.equal((await call("/api/sign-out", { cookie: freshCookie, body: {} })).status, 200);
  assert.equal((await call("/api/workspace", { cookie: freshCookie })).status, 401);
});

test("browser export import preserves history and rejects conflicting copies", async t => {
  const { writeFile } = require("node:fs/promises");
  const { spawnSync } = require("node:child_process");
  const dir = await mkdtemp(join(tmpdir(), "team-connect-import-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const filename = join(dir, "workspace.sqlite");
  const source = join(dir, "export.json");
  const savedMessage = { ...message(arnav, "History with apostrophes ' and emoji 💬"), id: "historical", editedAt: time };
  const workspace = {
    version: 1, servers: [{
      id: "launch", name: "Launch", memberIds: [admin.id, arnav.id],
      channels: [{ id: "general", name: "general", messages: [savedMessage], draft: "Keep draft" }]
    }]
  };
  const writeExport = () => writeFile(source, JSON.stringify({
    "teamconnect.workspace.v1": JSON.stringify(workspace),
    "teamconnect.password.v1": "excluded"
  }));
  const runImport = () => spawnSync(process.execPath, ["scripts/prepare-history-import.cjs", source], {
    encoding: "utf8", env: { ...process.env, TEAM_CONNECT_DB: filename }
  });
  await writeExport();
  assert.equal(runImport().status, 0);
  assert.equal(runImport().status, 0);
  const db = openDatabase(filename);
  try {
    const records = db.snapshot(admin).records;
    assert.deepEqual(records.map(record => record.kind).sort(), ["channel", "draft", "message", "server"]);
    assert.equal(records.find(record => record.kind === "message").data.text, savedMessage.text);
    assert.equal(records.find(record => record.kind === "message").data.editedAt, time);
  } finally {
    db.close();
  }
  savedMessage.text = "Conflicting history";
  await writeExport();
  const conflict = runImport();
  assert.equal(conflict.status, 1);
  assert.match(conflict.stderr, /Import conflicts/);
});

test("Supabase mode serves the browser SDK and public config without starting the SQLite API", async t => {
  const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example_key_for_test",
    SUPABASE_SECRET_KEY: "private-test-key"
  };
  const config = backendConfig(env);
  assert.deepEqual(config, { backend: "supabase", url: env.SUPABASE_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY });
  assert.deepEqual(backendConfig({ ...env, TEAM_CONNECT_BACKEND: "sqlite" }), { backend: "sqlite" });
  assert.throws(() => backendConfig({ ...env, SUPABASE_URL: "https://example.invalid" }), /Supabase project URL/);
  const server = createTeamConnectServer({ config });
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = "http://127.0.0.1:" + server.address().port;
  const options = { signal: AbortSignal.timeout(5000) };
  const [configResponse, sdk, sqlite] = await Promise.all([
    fetch(origin + "/js/backendConfig.js", options),
    fetch(origin + "/js/supabase-sdk.js", { ...options, method: "HEAD" }),
    fetch(origin + "/api/session", options)
  ]);
  const source = await configResponse.text();
  assert.match(source, /"backend":"supabase"/);
  assert.match(source, /sb_publishable_example_key_for_test/);
  assert.doesNotMatch(source, /private-test-key/);
  assert.equal(sdk.status, 200);
  assert.equal(sqlite.status, 404);
});
