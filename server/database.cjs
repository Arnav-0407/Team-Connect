const { DatabaseSync } = require("node:sqlite");
const { createHash, randomBytes, scrypt, timingSafeEqual } = require("node:crypto");
const { promisify, isDeepStrictEqual } = require("node:util");
const { mkdirSync, openSync, closeSync } = require("node:fs");
const { dirname, resolve } = require("node:path");

const accounts = [
  { id: "user-arnav", name: "Admin", email: "admin@gmail.com", role: "Workspace Admin" },
  { id: "employee-arnav", name: "Arnav Shaw", email: "arnavshaw@gmail.com", role: "Employee" },
  { id: "employee-parth", name: "Parth Singhal", email: "parthsinghal@gmail.com", role: "Employee" }
];
const databasePath = process.env.TEAM_CONNECT_DB || resolve(__dirname, "../.data/team-connect.sqlite");
const derive = promisify(scrypt);
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
const dummySalt = randomBytes(16);
const hash = value => createHash("sha256").update(value).digest("hex");
const object = value => value && typeof value === "object" && !Array.isArray(value);
const text = (value, min, max) => typeof value === "string" && value.length >= min && value.length <= max;
const date = value => typeof value === "string" && Number.isFinite(Date.parse(value));

class AppError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
function requireInput(condition, message = "Invalid workspace update.") {
  if (!condition) throw new AppError(400, message);
}
function allow(condition, message = "You don't have access to make this change.") {
  if (!condition) throw new AppError(403, message);
}
function equal(left, right) {
  return isDeepStrictEqual(left, right);
}
function only(data, fields) {
  return Object.keys(data).every(key => fields.includes(key));
}
function omit(data, fields) {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !fields.includes(key)));
}

function openDatabase(filename = databasePath) {
  if (filename !== ":memory:") {
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    closeSync(openSync(filename, "a", 0o600));
  }
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('Workspace Admin', 'Employee')),
      salt TEXT, password_hash TEXT, revision INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
    CREATE TABLE IF NOT EXISTS records (
      kind TEXT NOT NULL CHECK (kind IN ('server','channel','message','draft','profile','help','event')),
      id TEXT NOT NULL CHECK (length(id) BETWEEN 1 AND 300),
      data TEXT NOT NULL CHECK (json_valid(data) AND json_type(data) = 'object'),
      PRIMARY KEY (kind, id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS records_server ON records (kind, json_extract(data, '$.serverId'));
    CREATE INDEX IF NOT EXISTS records_channel ON records (kind, json_extract(data, '$.channelId'));
  `);
  const seed = db.prepare("INSERT OR IGNORE INTO accounts (id, name, email, role) VALUES (?, ?, ?, ?)");
  for (const account of accounts) seed.run(account.id, account.name, account.email, account.role);

  const findAccount = db.prepare("SELECT * FROM accounts WHERE id = ?");
  const findEmail = db.prepare("SELECT * FROM accounts WHERE email = ?");
  const directory = db.prepare("SELECT id, name, email, role FROM accounts");
  const readRecord = db.prepare("SELECT data FROM records WHERE kind = ? AND id = ?");
  const readKind = db.prepare("SELECT id, data FROM records WHERE kind = ?");
  const list = db.prepare("SELECT kind, id, data FROM records ORDER BY kind, id");
  const put = db.prepare("INSERT INTO records VALUES (?, ?, ?) ON CONFLICT(kind,id) DO UPDATE SET data = excluded.data");
  const remove = db.prepare("DELETE FROM records WHERE kind = ? AND id = ?");
  const removeServer = db.prepare("DELETE FROM records WHERE kind IN ('channel','message','draft') AND json_extract(data, '$.serverId') = ?");
  const removeChannel = db.prepare("DELETE FROM records WHERE kind IN ('message','draft') AND json_extract(data, '$.channelId') = ?");
  const trimEvents = db.prepare(`DELETE FROM records WHERE kind = 'event' AND id IN (
    SELECT id FROM records WHERE kind = 'event' ORDER BY julianday(json_extract(data, '$.time')) DESC, id LIMIT -1 OFFSET 500
  )`);
  const bump = db.prepare("UPDATE accounts SET revision = revision + 1 WHERE id = ?");
  const clearExpired = db.prepare("DELETE FROM sessions WHERE expires_at <= ?");
  const createSession = db.prepare("INSERT INTO sessions VALUES (?, ?, ?)");
  const getSession = db.prepare(`SELECT a.id, a.name, a.role, a.email, a.revision
    FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?`);
  const revokeSession = db.prepare("DELETE FROM sessions WHERE token_hash = ?");
  const revokeAccountSessions = db.prepare("DELETE FROM sessions WHERE account_id = ?");
  const saveCredentials = db.prepare("UPDATE accounts SET email = ?, salt = ?, password_hash = ? WHERE id = ?");

  function transaction(work) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  const read = (kind, id) => typeof id === "string" ? JSON.parse(readRecord.get(kind, id)?.data ?? "null") : null;
  const members = id => read("server", id)?.memberIds ?? [];

  async function verifyPassword(email, password) {
    const account = findEmail.get(email);
    const digest = await derive(password, account?.salt ? Buffer.from(account.salt, "hex") : dummySalt, 64);
    if (!account?.password_hash || !timingSafeEqual(digest, Buffer.from(account.password_hash, "hex")) ||
        findAccount.get(account.id)?.password_hash !== account.password_hash) return null;
    return account;
  }

  async function setPassword(id, password, email, expectedHash) {
    requireInput(text(password, 12, 1024), "Use a password of at least 12 characters.");
    const salt = randomBytes(16);
    const digest = await derive(password, salt, 64);
    transaction(() => {
      const account = findAccount.get(id);
      requireInput(account, "Unknown Team Connect account.");
      const address = email || account.email;
      requireInput(text(address, 3, 254) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address), "Enter a valid email address.");
      if (expectedHash && account.password_hash !== expectedHash) throw new AppError(409, "The password changed. Sign in again.");
      saveCredentials.run(address, salt.toString("hex"), digest.toString("hex"), id);
      revokeAccountSessions.run(id);
      for (const entry of directory.all()) bump.run(entry.id);
    });
  }

  function issueSession(accountId) {
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    clearExpired.run(now);
    createSession.run(hash(token), accountId, now + sessionLifetime);
    return token;
  }

  function snapshot(account) {
    const revision = findAccount.get(account.id).revision;
    const admin = account.role === "Workspace Admin";
    const entries = list.all().map(row => ({ ...row, data: JSON.parse(row.data) }));
    const servers = new Set(entries.filter(({ kind, data }) => kind === "server" && data.memberIds.includes(account.id))
      .map(({ id }) => id));
    return {
      account: account.id,
      revision,
      accounts: Object.fromEntries(directory.all().map(({ id, name, email, role }) => [
        id, { name, email: admin || id === account.id ? email : "", role }
      ])),
      records: entries.filter(({ kind, id, data }) => {
        if (kind === "server") return servers.has(id);
        if (kind === "channel" || kind === "message") return servers.has(data.serverId);
        if (kind === "draft") return data.owner === account.id && servers.has(data.serverId);
        if (kind === "help") return admin || data.authorId === account.id;
        return kind === "profile" || (kind === "event" && admin);
      }).map(record => record.kind === "profile" && record.id !== account.id
        ? { ...record, data: omit(record.data, ["email", "appearance"]) }
        : record)
    };
  }

  function commit(account, changes) {
    requireInput(Array.isArray(changes) && changes.length <= 600);
    const admin = account.role === "Workspace Admin";
    const people = directory.all();
    const accountIds = people.map(person => person.id);
    const adminIds = people.filter(person => person.role === "Workspace Admin").map(person => person.id);
    const affected = new Set();
    const notify = ids => ids.forEach(id => affected.add(id));

    return transaction(() => {
      for (const change of changes) {
        requireInput(object(change));
        const { kind, id, before, after } = change;
        requireInput(text(id, 1, 300) && (before === null || object(before)) && (after === null || object(after)));
        const previous = read(kind, id);
        const record = previous ?? after;
        requireInput(record);
        switch (kind) {
          case "server":
            allow(admin && (!previous || previous.memberIds.includes(account.id)));
            if (after) requireInput(
              only(after, ["name", "memberIds", "createdAt", "createdBy"]) && text(after.name, 1, 100) && after.name.trim() &&
              Array.isArray(after.memberIds) && after.memberIds.includes(account.id) &&
              after.memberIds.every(member => accountIds.includes(member)) &&
              new Set(after.memberIds).size === after.memberIds.length &&
              (!("createdAt" in after) || date(after.createdAt)) &&
              (!("createdBy" in after) || text(after.createdBy, 1, 60))
            );
            notify([...(previous?.memberIds ?? []), ...(after?.memberIds ?? [])]);
            break;
          case "channel":
            allow(admin && members(record.serverId).includes(account.id));
            if (after) {
              requireInput(only(after, ["name", "serverId", "archived", "createdAt"]) &&
                after.serverId === record.serverId && text(after.name, 1, 60) && after.name.trim() &&
                typeof after.archived === "boolean" && (!("createdAt" in after) || date(after.createdAt)));
              requireInput(!readKind.all("channel").some(row => {
                const channel = JSON.parse(row.data);
                return row.id !== id && channel.serverId === record.serverId && channel.name.toLowerCase() === after.name.toLowerCase();
              }), "A channel with that name already exists.");
            }
            notify(members(record.serverId));
            break;
          case "message":
          case "draft": {
            const channel = read("channel", record.channelId);
            allow(channel && !channel.archived && channel.serverId === record.serverId &&
              members(record.serverId).includes(account.id), "This channel is read-only or unavailable.");
            if (kind === "draft") {
              allow(record.owner === account.id && id === account.id + ":" + record.channelId);
              if (after) requireInput(only(after, ["text", "owner", "channelId", "serverId"]) &&
                equal(omit(after, ["text"]), omit(record, ["text"])) && text(after.text, 0, 2000));
              notify([account.id]);
              break;
            }
            if (previous?.removedBy && admin && equal(previous, after)) continue;
            allow(!previous?.removedBy && (previous
              ? previous.authorId === account.id || (admin && after?.removedBy === account.id)
              : after?.authorId === account.id && !("removedBy" in after)));
            if (after) {
              requireInput(only(after, ["text", "authorId", "authorName", "createdAt", "editedAt", "removedBy", "serverId", "channelId"]) &&
                equal(omit(after, ["text", "editedAt", "removedBy"]), omit(record, ["text", "editedAt", "removedBy"])) &&
                text(after.authorName, 1, 60) && date(after.createdAt) && (!("editedAt" in after) || date(after.editedAt)) &&
                ("removedBy" in after
                  ? admin && previous && previous.authorId !== account.id && after.removedBy === account.id && after.text === ""
                  : text(after.text, 1, 2000) && after.text.trim().length > 0));
            }
            if (!previous && /(?:^|\s)@admin\b/i.test(after.text) && !admin) {
              const server = read("server", record.serverId);
              put.run("event", "mention:" + id.slice(0, 250), JSON.stringify({
                time: after.createdAt, actor: after.authorName, serverId: record.serverId, server: server.name,
                category: "Mentions", action: "Mentioned @Admin in #" + channel.name, read: false
              }));
              notify(adminIds);
            }
            notify(members(record.serverId));
            break;
          }
          case "profile": {
            allow(id === account.id && after);
            requireInput(only(after, ["name", "email", "designation", "photo", "presence", "appearance"]) &&
              Object.entries({ name: 60, email: 254, designation: 80, photo: 349552 }).every(([key, max]) =>
                !(key in after) || text(after[key], 0, max)) &&
              (!after.photo || /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(after.photo)) &&
              (!("presence" in after) || ["active", "away", "busy", "stealth"].includes(after.presence)) &&
              (!("appearance" in after) || object(after.appearance)));
            const publicFields = ["email", "appearance"];
            notify(equal(omit(previous ?? {}, publicFields), omit(after, publicFields)) ? [id] : accountIds);
            break;
          }
          case "help":
            allow(after && (previous ? admin : !admin && after.authorId === account.id));
            if (previous) requireInput(previous.status === "Pending" && ["Resolved", "Rejected"].includes(after.status) &&
              equal(omit(after, ["status", "reply"]), omit(previous, ["status", "reply"])) &&
              (!("reply" in after) || text(after.reply, 0, 1000)));
            else requireInput(only(after, ["authorId", "createdAt", "status", "message"]) &&
              after.status === "Pending" && text(after.message, 1, 1000) && after.message.trim().length && date(after.createdAt));
            notify([...adminIds, record.authorId]);
            break;
          case "event":
            allow(admin);
            requireInput(after && date(after.time) && typeof after.read === "boolean" &&
              ["actor", "action", "category", "serverId", "server"].every(key => typeof after[key] === "string"));
            notify(adminIds);
            break;
          default:
            throw new AppError(400, "Unknown workspace record.");
        }

        if (!equal(previous, before)) {
          if (equal(previous, after) || (kind === "draft" && !after)) continue;
          if (kind !== "draft") throw new AppError(409, "This item changed elsewhere. Try again.", "40001");
        }
        if (after) put.run(kind, id, JSON.stringify(after));
        else {
          remove.run(kind, id);
          if (kind === "server") removeServer.run(id);
          if (kind === "channel") removeChannel.run(id);
        }
      }
      trimEvents.run();
      affected.forEach(id => bump.run(id));
      return affected;
    });
  }

  function importRecords(records) {
    return transaction(() => {
      for (const { kind, id, data } of JSON.parse(JSON.stringify(records))) {
        const previous = read(kind, id);
        if (previous && !equal(previous, data)) throw new Error("Import conflicts with existing " + kind + " " + id);
        put.run(kind, id, JSON.stringify(data));
      }
      const accountIds = directory.all().map(person => person.id);
      for (const { kind, id, data: json } of list.all()) {
        const data = JSON.parse(json);
        if (kind === "server") {
          requireInput(text(data.name, 1, 100) && Array.isArray(data.memberIds) &&
            data.memberIds.every(member => accountIds.includes(member)), "Invalid imported server " + id);
        }
        if (["channel", "message", "draft"].includes(kind)) {
          requireInput(read("server", data.serverId), "Missing server for imported " + kind + " " + id);
        }
        if (kind === "message" || kind === "draft") {
          requireInput(read("channel", data.channelId)?.serverId === data.serverId,
            "Missing channel for imported " + kind + " " + id);
        }
        if (kind === "message") {
          requireInput(typeof data.text === "string" && typeof data.authorId === "string" &&
            typeof data.authorName === "string" && date(data.createdAt), "Invalid imported message " + id);
        }
      }
      trimEvents.run();
      for (const id of accountIds) bump.run(id);
    });
  }

  return {
    close: () => db.close(), snapshot, commit, importRecords, verifyPassword, setPassword, issueSession,
    sessionLifetime,
    session: token => token && getSession.get(hash(token), Date.now()),
    signOut: token => { if (token) revokeSession.run(hash(token)); }
  };
}

module.exports = { accounts, AppError, openDatabase, databasePath };
