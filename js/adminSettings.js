const adminSections = ["Workspace Management", "Activity Log", "Data & Privacy", "Notifications", "Help & Diagnostics"];
let adminSection = 0;
let managementView = "Members";
let memberQuery = "";
let logServer = "";
let logCategory = "";

function serverFor(workspace, serverId) {
  return workspace.servers.find(server => server.id === serverId);
}

function recordEvent(workspace, server, category, action) {
  workspace.events ??= [];
  workspace.events.push({ id: id(), time: new Date().toISOString(), actor: currentUser.name,
    serverId: server.id, server: server.name, category, action, read: false });
  workspace.events = workspace.events.slice(-500);
}

function inbox(workspace) {
  const prefs = workspace.alerts ?? {};
  return (workspace.events ?? []).filter(event =>
    ["Membership", "Mentions"].includes(event.category) && prefs[event.category] !== false &&
    !prefs.muted?.includes(event.serverId));
}

function initAdminSettings() {
  adminSections.forEach((name, i) => {
    $("#admin-open-" + i).addEventListener("click", () => {
      if (!isAdmin()) return;
      adminSection = i;
      $("#admin-title").textContent = name;
      $("#admin-status").textContent = "";
      showSettingsPage($("#admin-page"), $("#admin-title"));
      refreshAdminSettings();
    });
  });
  $("#admin-close").addEventListener("click", exitSettingsPage);
}

function refreshAdminSettings() {
  adminSections.forEach((_, i) => { $("#admin-menu-" + i).hidden = !isAdmin(); });
  if (!isAdmin()) return;
  const unread = inbox(state).filter(event => !event.read).length;
  $("#admin-open-3").textContent = unread ? "Notifications (" + unread + ")" : "Notifications";
  if ($("#admin-page").hidden) return;
  $("#admin-controls").replaceChildren();
  $("#admin-results").replaceChildren();
  [managementSettings, activitySettings, dataSettings, notificationSettings, diagnosticSettings][adminSection]();
}

function settingsButton(label, action) {
  const button = node("button", "button secondary", label);
  button.type = "button";
  button.addEventListener("click", () => { if (isAdmin()) action(); });
  return button;
}

function settingsSelect(label, options, selected, change) {
  const field = node("label", "admin-field", label);
  const select = node("select");
  for (const [value, text] of options) {
    const option = node("option", "", text);
    option.value = value;
    select.append(option);
  }
  select.value = selected;
  select.addEventListener("change", () => { if (isAdmin()) change(select.value); });
  field.append(select);
  return field;
}

function managementSettings() {
  const controls = $("#admin-controls");
  const server = activeServer();
  controls.append(settingsButton("Create server", () => openCreate("server")));
  if (!server) return;
  controls.append(settingsSelect("Server", state.servers.map(s => [s.id, s.name]), server.id, value => {
    if (updateState(next => { next.activeServerId = value; })) render();
  }));
  for (const view of ["Members", "Channels"]) {
    const button = settingsButton(view, () => { managementView = view; refreshAdminSettings(); });
    button.setAttribute("aria-pressed", String(view === managementView));
    controls.append(button);
  }
  const results = $("#admin-results");
  if (managementView === "Members") {
    controls.append(settingsButton("Add member", () => $("#add-member").click()));
    const search = node("input");
    search.type = "search";
    search.setAttribute("aria-label", "Search members by name or email");
    search.placeholder = "Search name or email";
    search.value = memberQuery;
    controls.append(search);
    const listMembers = () => {
      const list = node("ul", "admin-list");
      for (const id of memberIds(server)) {
        const user = loadUser(id);
        if (!(user.name + " " + demoUsers[id].email).toLowerCase().includes(memberQuery.toLowerCase())) continue;
        const row = memberRow(server, id);
        row.append(node("small", "", "Servers: " + state.servers.filter(s => memberIds(s).includes(id)).map(s => s.name).join(", ")));
        list.append(row);
      }
      results.replaceChildren(list.children.length ? list : node("p", "", "No matching members."));
    };
    search.addEventListener("input", () => { memberQuery = search.value; listMembers(); });
    listMembers();
  } else {
    controls.append(settingsButton("Create channel", () => openCreate("channel")));
    if (!server.channels.length) results.append(node("p", "", "No channels yet."));
    for (const channel of server.channels) {
      const row = node("div", "member-row");
      row.append(node("span", "", "#" + channel.name + (channel.archived ? " · Archived" : "")),
        settingsButton(channel.archived ? "Restore" : "Archive", () => setChannelArchived(server.id, channel.id, !channel.archived)));
      results.append(row);
    }
  }
}

function activitySettings() {
  const events = state.events ?? [];
  const servers = new Map(events.map(event => [event.serverId, event.server]));
  const categories = [...new Set(events.map(event => event.category))];
  $("#admin-controls").append(settingsSelect("Server", [["", "All servers"], ...servers], logServer, value => {
    logServer = value; refreshAdminSettings();
  }), settingsSelect("Action", [["", "All actions"], ...categories.map(c => [c, c])], logCategory, value => {
    logCategory = value; refreshAdminSettings();
  }));
  showEvents(events.filter(e => (!logServer || e.serverId === logServer) && (!logCategory || e.category === logCategory)));
}

function showEvents(events) {
  const list = node("ul", "admin-list");
  for (const event of [...events].reverse()) {
    const row = node("li");
    row.append(node("strong", "", event.action),
      node("small", "", [event.actor, event.server, new Date(event.time).toLocaleString()].join(" · ")));
    list.append(row);
  }
  $("#admin-results").append(events.length ? list : node("p", "", "No matching activity yet."));
}

function notificationSettings() {
  const controls = $("#admin-controls");
  const prefs = state.alerts ?? {};
  function toggle(label, checked, change) {
    const field = node("label", "admin-check");
    const input = node("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => {
      if (isAdmin() && updateState(next => { next.alerts ??= {}; change(next.alerts, input.checked); })) render();
      else input.checked = checked;
    });
    field.append(input, node("span", "", label));
    controls.append(field);
  }
  for (const category of ["Membership", "Mentions"]) {
    toggle(category === "Mentions" ? "@Admin mentions" : "Membership changes", prefs[category] !== false,
      (next, checked) => { next[category] = checked; });
  }
  for (const server of state.servers) {
    toggle("Mute " + server.name, !!prefs.muted?.includes(server.id), (next, checked) => {
      next.muted = (next.muted ?? []).filter(id => id !== server.id);
      if (checked) next.muted.push(server.id);
    });
  }
  controls.append(settingsButton("Mark all as read", () => {
    if (updateState(next => { for (const event of inbox(next)) event.read = true; })) render();
  }));
  showEvents(inbox(state));
}

function validAdminData(value) {
  const events = value?.events ?? [];
  const alerts = value?.alerts ?? {};
  return Array.isArray(events) && events.length <= 500 && events.every(e => e &&
    ["id", "actor", "action", "category", "serverId", "server", "time"].every(key => typeof e[key] === "string") &&
    Number.isFinite(Date.parse(e.time)) && typeof e.read === "boolean") &&
    typeof alerts === "object" && !Array.isArray(alerts) &&
    ["Membership", "Mentions"].every(key => alerts[key] === undefined || typeof alerts[key] === "boolean") &&
    (alerts.muted === undefined || (Array.isArray(alerts.muted) && alerts.muted.every(id => typeof id === "string")));
}

function replaceWorkspace(next, prompt) {
  if (!isAdmin() || !window.confirm(prompt)) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  state = next;
  storageBlocked = false;
  workspaceError("");
  render();
  $("#admin-status").textContent = "Workspace updated.";
}

function dataSettings() {
  const controls = $("#admin-controls");
  controls.append(node("p", "", "Workspace backups include servers, memberships, messages, drafts, activity and notification preferences. Personal profiles and appearance settings are stored separately in this browser."));
  controls.append(settingsButton("Export workspace backup", () => {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!validateState(value)) throw Error();
      const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
      const link = node("a");
      link.href = url;
      link.download = "teamconnect-workspace.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { $("#admin-status").textContent = "Could not export a valid workspace."; }
  }));
  const label = node("label", "admin-field", "Restore workspace backup");
  const file = node("input");
  file.type = "file";
  file.accept = ".json,application/json";
  file.addEventListener("change", async () => {
    if (!isAdmin() || !file.files.length) return;
    try {
      const value = JSON.parse(await file.files[0].text());
      if (!validateState(value)) throw Error();
      replaceWorkspace(removeDefaults(value), "Replace this browser’s workspace with the selected backup?");
    } catch { $("#admin-status").textContent = "Restore failed. Check the backup format and available browser storage."; }
    file.value = "";
  });
  label.append(file);
  controls.append(label, settingsButton("Reset workspace data", () => {
    try { replaceWorkspace(emptyWorkspace(), "Delete all servers, messages, drafts, memberships and activity in this browser?"); }
    catch { $("#admin-status").textContent = "Could not reset workspace storage."; }
  }));
}

function diagnosticSettings() {
  let storage = "Available";
  try { localStorage.getItem(STORAGE_KEY); } catch { storage = "Unavailable"; }
  if (storageBlocked) storage = "Workspace storage error";
  const report = ["TeamConnect workspace format v" + state.version, "Browser storage: " + storage,
    "Workspace error: " + ($("#workspace-error").textContent || "None")].join("\n");
  $("#admin-results").append(node("h2", "", "Keyboard shortcuts"),
    node("p", "", "Enter sends a message. Shift+Enter starts a new line. Shift+F10 opens options on a focused server or channel. Escape closes settings."),
    node("h2", "", "Diagnostic report"), node("pre", "", report), settingsButton("Copy report", async () => {
      try { await navigator.clipboard.writeText(report); $("#admin-status").textContent = "Report copied."; }
      catch { $("#admin-status").textContent = "Select the report above to copy it."; }
    }));
}
