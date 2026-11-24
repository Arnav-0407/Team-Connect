const adminSections = ["Workspace Management", "Activity Log", "Data & Privacy", "Help Centre"];
const HELP_SECTION = 3;
const helpStatuses = ["Pending", "Resolved", "Rejected"];
const MAX_HELP_LENGTH = 1000;
let adminSection = 0;
let managementServerId = null;
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

function initAdminSettings() {
  adminSections.slice(1).forEach((_, index) => {
    const section = index + 1;
    $("#admin-open-" + section).addEventListener("click", () => openAdminSection(section));
  });
  $("#admin-close").addEventListener("click", exitSettingsPage);
}

function openAdminSection(section, serverId = null) {
  if (!currentUser || (section !== HELP_SECTION && !isAdmin())) return;
  adminSection = section;
  managementServerId = serverId;
  $("#admin-title").textContent = adminSections[section];
  $("#admin-status").textContent = "";
  $("#admin-results").replaceChildren();
  showSettingsPage($("#admin-page"), $("#admin-title"));
  refreshAdminSettings();
}

function refreshAdminSettings() {
  $("#admin-menu-1").hidden = !isAdmin();
  $("#admin-menu-2").hidden = !isAdmin();
  $("#admin-menu-3").hidden = !currentUser;
  if ($("#admin-page").hidden || !currentUser) return;
  if (adminSection === HELP_SECTION) {
    helpSettings();
    return;
  }
  if (!isAdmin()) return;
  if ($("#admin-page").hidden || (adminSection === 2 && $("#change-password-form"))) return;
  $("#admin-controls").replaceChildren();
  $("#admin-results").replaceChildren();
  [managementSettings, activitySettings, dataSettings][adminSection]();
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
  const server = serverFor(state, managementServerId);
  const results = $("#admin-results");
  $("#admin-title").textContent = server ? "Workspace Management · " + server.name : "Workspace Management";
  if (!server) {
    results.append(node("p", "", "This server is no longer available."));
    return;
  }
  for (const view of ["Members", "Channels"]) {
    const button = settingsButton(view, () => { managementView = view; refreshAdminSettings(); });
    button.setAttribute("aria-pressed", String(view === managementView));
    controls.append(button);
  }
  if (managementView === "Members") {
    const toolbar = node("div", "member-toolbar");
    const addMember = settingsButton("Add member", () => openAddMember(server.id));
    addMember.classList.add("member-add");
    const search = node("input");
    search.type = "search";
    search.setAttribute("aria-label", "Search members by name or email");
    search.placeholder = "Search name or email";
    search.value = memberQuery;
    toolbar.append(search, addMember);
    const memberResults = node("div");
    results.append(toolbar, memberResults);
    const listMembers = () => {
      const list = node("ul", "admin-list managed-members");
      for (const id of memberIds(server)) {
        const user = loadUser(id);
        if (!(user.name + " " + (cloudEnabled ? cloudAccounts : demoUsers)[id].email).toLowerCase().includes(memberQuery.toLowerCase())) continue;
        list.append(memberRow(id, server));
      }
      memberResults.replaceChildren(list.children.length ? list : node("p", "", "No matching members."));
    };
    search.addEventListener("input", () => { memberQuery = search.value; listMembers(); });
    listMembers();
  } else {
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

function validAdminData(value) {
  const events = value?.events ?? [];
  const alerts = value?.alerts ?? {};
  const helpRequests = value?.helpRequests ?? [];
  if (!Array.isArray(helpRequests) || !helpRequests.every(request => request &&
    typeof request.id === "string" && Object.hasOwn(cloudEnabled ? cloudAccounts : demoUsers, request.authorId) && request.authorId !== ADMIN_ID &&
    typeof request.message === "string" && request.message.trim() && request.message.length <= MAX_HELP_LENGTH &&
    (request.reply === undefined || (typeof request.reply === "string" && request.reply.length <= MAX_HELP_LENGTH)) &&
    Number.isFinite(Date.parse(request.createdAt)) && helpStatuses.includes(request.status))) return false;
  return Array.isArray(events) && events.length <= 500 && events.every(e => e &&
    ["id", "actor", "action", "category", "serverId", "server", "time"].every(key => typeof e[key] === "string") &&
    Number.isFinite(Date.parse(e.time)) && typeof e.read === "boolean") &&
    typeof alerts === "object" && !Array.isArray(alerts) &&
    ["Membership", "Mentions"].every(key => alerts[key] === undefined || typeof alerts[key] === "boolean") &&
    (alerts.muted === undefined || (Array.isArray(alerts.muted) && alerts.muted.every(id => typeof id === "string")));
}

function dataSettings() {
  const form = node("form", "change-password-form");
  form.id = "change-password-form";
  const heading = node("h2", "", "Change password");
  const passwordFields = node("div", "password-fields");
  const fields = [
    ["Current password", "current-password"],
    ["New password", "new-password"],
    ["Confirm new password", "new-password"]
  ].map(([label, autocomplete], index) => {
    const field = node("div", "account-row");
    const input = node("input");
    input.id = "change-password-" + index;
    input.type = "password";
    input.autocomplete = autocomplete;
    input.required = true;
    const caption = node("label", "", label);
    caption.htmlFor = input.id;
    field.append(caption);
    if (index < 2) {
      const control = node("div", "password-visibility");
      const toggle = node("button", "icon-button password-toggle");
      toggle.type = "button";
      toggle.setAttribute("aria-label", "Show " + label.toLowerCase());
      toggle.setAttribute("aria-controls", input.id);
      const eye = node("span", "password-eye");
      eye.setAttribute("aria-hidden", "true");
      toggle.append(eye);
      const setVisible = visible => {
        input.type = visible ? "text" : "password";
        toggle.setAttribute("aria-pressed", String(visible));
        toggle.title = (visible ? "Hide " : "Show ") + label.toLowerCase();
      };
      setVisible(false);
      toggle.addEventListener("click", () => setVisible(input.type === "password"));
      form.addEventListener("reset", () => setVisible(false));
      control.append(input, toggle);
      field.append(control);
    } else {
      field.append(input);
    }
    passwordFields.append(field);
    return input;
  });
  const [current, next, confirm] = fields;
  next.minLength = 8;
  next.setAttribute("aria-describedby", "new-password-hint");
  const hint = node("p", "settings-note", "Use at least 8 characters.");
  hint.id = "new-password-hint";
  const button = node("button", "button primary", "Save password");
  button.type = "submit";
  const feedback = node("p", "message-error");
  feedback.setAttribute("role", "alert");
  const actions = node("div", "password-actions");
  actions.append(hint, button);
  form.append(passwordFields, feedback, actions);
  const footer = node("footer", "privacy-footer");
  for (const title of ["Terms & Conditions", "Privacy Policy"]) {
    const row = node("div", "privacy-document");
    const view = node("button", "button secondary", "View");
    view.type = "button";
    view.disabled = true;
    view.setAttribute("aria-label", "View " + title);
    row.append(node("span", "", title), view);
    footer.append(row);
  }
  $("#admin-results").append(heading, form, footer);

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!cloud || !isAdmin() || button.disabled) return;
    const oldPassword = current.value;
    const newPassword = next.value;
    const user = currentUser;
    feedback.textContent = "";
    $("#admin-status").textContent = "";
    const minimumLength = 12;
    if (newPassword.length < minimumLength || newPassword !== confirm.value || oldPassword === newPassword) {
      feedback.textContent = `Choose a different password of at least ${minimumLength} characters and enter it twice.`;
      return;
    }
    for (const input of fields) input.readOnly = true;
    button.disabled = true;
    try {
      await cloud.changePassword(cloudAccounts[user.id].email, oldPassword, newPassword);
      if (currentUser === user) {
        form.reset();
        $("#admin-status").textContent = "Password changed. Use your new password next time you sign in.";
      }
    } catch (error) {
      if (error.code === "invalid_credentials") {
        feedback.textContent = "The current password is incorrect.";
        return;
      }
      feedback.textContent = "Could not change the password. Check your connection and try again.";
    } finally {
      button.disabled = false;
      for (const input of fields) input.readOnly = false;
    }
  });
}

function helpSettings() {
  let list = $("#help-request-list");
  if (!list) {
    const controls = $("#admin-controls");
    controls.replaceChildren();
    if (!isAdmin()) controls.append(helpRequestForm());

    const panel = node("section", "help-requests-panel");
    const heading = node("h2", "", isAdmin() ? "Help requests" : "My requests");
    heading.id = "help-requests-title";
    list = node("ul", "help-request-list");
    list.id = "help-request-list";
    list.tabIndex = 0;
    list.setAttribute("aria-labelledby", heading.id);
    panel.append(heading, list);
    $("#admin-results").append(panel);
  }

  const requests = (state.helpRequests ?? []).filter(request => isAdmin() || request.authorId === currentUser.id);
  const drafts = new Map(Array.from(list.querySelectorAll("[data-help-reply]"), input => [input.dataset.helpReply, input]));
  const focused = document.activeElement;
  list.replaceChildren(...(requests.length
    ? requests.slice().reverse().map(request => helpRequestRow(request, drafts.get(request.id)))
    : [node("li", "", "No help requests yet.")]));
  if (focused?.matches("[data-help-reply]") && list.contains(focused)) focused.focus({ preventScroll: true });
}

function helpRequestForm() {
  const form = node("form", "help-request-form");
  form.id = "help-request-form";
  const label = node("label", "admin-field", "What do you need help with?");
  const message = node("textarea");
  message.rows = 4;
  message.required = true;
  message.maxLength = MAX_HELP_LENGTH;
  label.append(message);
  const submit = node("button", "button primary", "Send request");
  submit.type = "submit";
  form.append(label, submit);

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!currentUser || isAdmin() || !form.isConnected) return;
    const text = message.value.trim();
    if (!text || text.length > MAX_HELP_LENGTH) {
      $("#admin-status").textContent = "Enter a request of 1–1,000 characters.";
      return;
    }
    const request = { id: id(), authorId: currentUser.id, message: text,
      createdAt: new Date().toISOString(), status: "Pending" };
    if (!await updateState(next => {
      next.helpRequests ??= [];
      next.helpRequests.push(request);
    })) {
      $("#admin-status").textContent = "Could not save your request. Try again.";
      return;
    }
    form.reset();
    helpSettings();
    $("#admin-status").textContent = "Request sent to the workspace admin.";
  });
  return form;
}

function helpRequestRow(request, draft) {
  const row = node("li", "help-request");
  const header = node("div", "help-request-heading");
  const date = new Date(request.createdAt);
  const time = node("time", "", date.toLocaleString());
  time.dateTime = request.createdAt;
  const author = loadUser(request.authorId);
  const status = node("span", "help-status", request.status);
  status.setAttribute("data-status", request.status.toLowerCase());
  header.append(node("strong", "", author.name), status);
  row.append(header, time, node("p", "help-request-message", request.message));
  if (request.reply) {
    const reply = node("div", "help-saved-reply");
    reply.append(node("strong", "", "Admin reply"), node("p", "help-request-message", request.reply));
    row.append(reply);
  }
  if (isAdmin() && request.status === "Pending") {
    const reply = draft ?? node("textarea");
    reply.className = "help-reply-field";
    reply.dataset.helpReply = request.id;
    reply.maxLength = MAX_HELP_LENGTH;
    reply.placeholder = "Write a reply…";
    reply.setAttribute("aria-label", "Reply to employee (optional)");
    const actions = node("div", "help-actions");
    for (const decision of ["Resolved", "Rejected"]) {
      const button = settingsButton(decision, () => reviewHelpRequest(request.id, decision, reply.value.trim()));
      button.classList.add(decision === "Resolved" ? "help-resolve" : "help-reject");
      actions.append(button);
    }
    row.append(reply, actions);
  }
  return row;
}

async function reviewHelpRequest(requestId, decision, reply) {
  if (!isAdmin() || !["Resolved", "Rejected"].includes(decision)) return;
  if (reply.length > MAX_HELP_LENGTH) {
    $("#admin-status").textContent = "Keep your reply to 1,000 characters or fewer.";
    return;
  }
  let reviewed = false;
  const saved = await updateState(next => {
    const request = next.helpRequests?.find(entry => entry.id === requestId);
    if (request?.status !== "Pending") return;
    request.status = decision;
    if (reply) request.reply = reply;
    reviewed = true;
  });
  if (saved) {
    helpSettings();
    $("#admin-title").focus();
  }
  $("#admin-status").textContent = saved
    ? (reviewed ? "Request marked " + decision.toLowerCase() + "." : "This request has already been reviewed.")
    : "Could not update the request. Try again.";
}
