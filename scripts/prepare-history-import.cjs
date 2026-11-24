const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const { openDatabase } = require("../server/database.cjs");

const context = vm.createContext({});
vm.runInContext(readFileSync(require.resolve("../js/data/cloudWorkspace.js"), "utf8"), context);
const { cloudWorkspaceRecords } = context;
const accounts = ["user-arnav", "employee-arnav", "employee-parth"];
const merged = new Map();

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

function add(record) {
  const key = record.kind + ":" + record.id;
  const previous = merged.get(key);
  if (previous && JSON.stringify(canonical(previous.data)) !== JSON.stringify(canonical(record.data))) {
    throw new Error("Exports disagree on " + key + ". Reconcile the copies before importing.");
  }
  merged.set(key, record);
}

function readExport(filename) {
  const file = JSON.parse(readFileSync(filename, "utf8"));
  let workspace = JSON.parse(file["teamconnect.workspace.v1"] ?? "null");
  const legacy = JSON.parse(file["teamconnect.general.messages.v1"] ?? "[]");
  if (workspace && (workspace.version !== 1 || !Array.isArray(workspace.servers))) {
    throw new Error(filename + " does not contain a supported workspace");
  }
  if (legacy.length && !workspace?.servers.length) {
    workspace = { ...workspace, servers: [{
      id: "legacy-team-connect", name: "TeamConnect", memberIds: accounts,
      channels: [{ id: "legacy-general", name: "general", messages: legacy }]
    }] };
  }
  if (workspace) {
    for (const account of accounts) {
      cloudWorkspaceRecords(workspace, account, accounts).forEach(add);
    }
  }
  for (const account of accounts) {
    const suffix = account === accounts[0] ? "" : "." + account;
    const profile = JSON.parse(file["teamconnect.profile.v1" + suffix] ?? "{}");
    const appearance = JSON.parse(file["teamconnect.appearance.v1" + suffix] ?? "null");
    const presence = file["teamconnect.presence" + suffix];
    const { name, email, designation, photo } = profile;
    const data = { name, email, designation, photo };
    if (appearance) data.appearance = appearance;
    if (presence) data.presence = presence;
    if (Object.values(data).some(value => value !== undefined)) add({ kind: "profile", id: account, data });
  }
}

try {
  const filenames = process.argv.slice(2);
  if (!filenames.length) throw new Error("Usage: node scripts/prepare-history-import.cjs export.json [another-export.json]");
  filenames.forEach(readExport);
  if (!merged.size) throw new Error("The exports contain no workspace history or settings.");
  const db = openDatabase();
  try {
    db.importRecords([...merged.values()]);
    console.log("Imported " + merged.size + " records into the SQLite workspace.");
  } finally {
    db.close();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
