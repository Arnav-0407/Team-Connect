const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const { DatabaseSync } = require("node:sqlite");
const { openDatabase, databasePath } = require("../server/database.cjs");

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

function readSqlite() {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    for (const { kind, id, data } of db.prepare("SELECT kind, id, data FROM records").all()) {
      add({ kind, id, data: JSON.parse(data) });
    }
  } finally {
    db.close();
  }
}

function supabaseImport(records) {
  const payload = Buffer.from(JSON.stringify(records), "utf8").toString("hex");
  return `begin;
select pg_advisory_xact_lock(26318, 1);
create temporary table team_connect_history_import on commit drop as
  select * from jsonb_to_recordset(convert_from(decode('${payload}', 'hex'), 'UTF8')::jsonb)
    as history(kind text, id text, data jsonb);
do $$
begin
  if (select count(*) from team_connect.accounts) < 3 then
    raise exception 'Link the three Team Connect accounts first.';
  end if;
  if exists (select 1 from team_connect_history_import i
    join team_connect.records r using (kind, id) where i.data <> r.data) then
    raise exception 'Import conflicts with existing Team Connect records.';
  end if;
end;
$$;
insert into team_connect.records (kind, id, data)
  select kind, id, data from team_connect_history_import on conflict (kind, id) do nothing;
update public.team_connect_sync set revision = revision + 1;
commit;`;
}

try {
  const args = process.argv.slice(2);
  const toSupabase = args[0] === "--supabase";
  const filenames = toSupabase ? args.slice(1) : args;
  if (!toSupabase && !filenames.length) throw new Error(
    "Usage: npm run import-history -- [--supabase] export.json [another-export.json]"
  );
  if (toSupabase && !filenames.length) readSqlite();
  else filenames.forEach(readExport);
  if (!merged.size) throw new Error("The source contains no workspace history or settings.");
  if (toSupabase) {
    console.log(supabaseImport([...merged.values()]));
    console.error("Prepared " + merged.size + " records for Supabase import.");
  } else {
    const db = openDatabase();
    try {
      db.importRecords([...merged.values()]);
      console.log("Imported " + merged.size + " records into the SQLite workspace.");
    } finally {
      db.close();
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
