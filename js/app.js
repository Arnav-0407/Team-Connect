const STORAGE_KEY = "teamconnect.workspace.v1";
const MAX_MESSAGE_LENGTH = 2000;
const PROFILE_KEY = "teamconnect.profile.v1";
const PRESENCE_KEY = "teamconnect.presence";
const APPEARANCE_KEY = "teamconnect.appearance.v1";
const appearanceOptions = {
  theme: ["browser", "light", "dark"],
  textSize: ["default", "small", "large", "extra-large"],
  font: ["system", "serif", "mono"],
  density: ["default", "compact", "spacious"]
};
const presenceOptions = {
  active: { label: "Active", icon: "●" },
  away: { label: "Away", icon: "◷" },
  busy: { label: "Busy", icon: "⊖" },
  stealth: { label: "Stealth", icon: "○" }
};
let presence = "active";
const MAX_DESIGNATION_LENGTH = 80;
const currentUser = { id: "user-arnav", name: "Arnav", email: "", designation: "" };
try {
  const profile = JSON.parse(localStorage.getItem(PROFILE_KEY));
  if (typeof profile?.name === "string" && profile.name.trim() && profile.name.length <= 60) currentUser.name = profile.name.trim();
  if (typeof profile?.email === "string" && profile.email.length <= 254) currentUser.email = profile.email;
  if (typeof profile?.designation === "string" && profile.designation.length <= MAX_DESIGNATION_LENGTH) {
    currentUser.designation = profile.designation;
  }
} catch { /* Keep the existing profile if browser storage is unavailable. */ }
try {
  const savedPresence = localStorage.getItem(PRESENCE_KEY);
  if (Object.hasOwn(presenceOptions, savedPresence)) presence = savedPresence;
} catch { /* Keep the default status if browser storage is unavailable. */ }
const $ = (selector) => document.querySelector(selector);
const messageInput = $("#message-input");
const messageList = $("#message-list");
const messageForm = $("#message-form");
const chat = $(".chat");
const sidebar = $("#sidebar");
const menuButton = $("#menu-button");
const dialog = $("#create-dialog");
let dialogMode = "server";
let storageBlocked = false;

function id() {
  return globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function makeChannel(name, messages = []) {
  return { id: id(), name, messages, draft: "" };
}
function makeServer(name) {
  return {
    id: id(),
    name,
    createdBy: currentUser.name,
    createdAt: new Date().toISOString(),
    channels: [],
    activeChannelId: null
  };
}
function emptyWorkspace() {
  return { version: 1, defaultsRemoved: true, servers: [], activeServerId: null };
}
function removeDefaults(value) {
  if (value.defaultsRemoved) return value;
  for (const server of value.servers) {
    for (const channel of server.channels) {
      channel.messages = channel.messages.filter((message) =>
        !((message.id === "sample-1" && message.authorId === "user-priya") ||
          (message.id === "sample-2" && message.authorId === "user-arnav")));
    }
    const defaultNames = ["general", "planning", "resources"];
    if (defaultNames.every((name) => server.channels.some((channel) => channel.name === name))) {
      server.channels = server.channels.filter((channel) =>
        !defaultNames.includes(channel.name) || channel.messages.length || channel.draft);
    }
    if (!server.channels.some((channel) => channel.id === server.activeChannelId)) {
      server.activeChannelId = server.channels[0]?.id ?? null;
    }
  }
  value.servers = value.servers.filter((server) => server.name !== "TeamConnect" || server.channels.length);
  if (!value.servers.some((server) => server.id === value.activeServerId)) {
    value.activeServerId = value.servers[0]?.id ?? null;
  }
  value.defaultsRemoved = true;
  return value;
}
function validMessages(messages) {
  return Array.isArray(messages) && messages.every((m) => m &&
    [m.id, m.authorId, m.authorName, m.text, m.createdAt].every((value) => typeof value === "string") &&
    Number.isFinite(Date.parse(m.createdAt)));
}
function validateState(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.servers)) return false;
  const ids = new Set();
  const unique = (value) => {
    if (typeof value !== "string" || !value || ids.has(value)) return false;
    ids.add(value);
    return true;
  };
  return value.servers.every((server) => server && unique(server.id) &&
    typeof server.name === "string" && server.name.trim() && Array.isArray(server.channels) &&
    server.channels.every((channel) => channel && unique(channel.id) && typeof channel.name === "string" && channel.name.trim() &&
      typeof channel.draft === "string" && validMessages(channel.messages)) &&
    (server.channels.length ? server.channels.some((channel) => channel.id === server.activeChannelId) : server.activeChannelId === null)) &&
    (value.servers.length ? value.servers.some((server) => server.id === value.activeServerId) : value.activeServerId === null);
}
function workspaceError(message) {
  $("#workspace-error").textContent = message;
  $("#workspace-error").hidden = !message;
}
function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved !== null) {
      const value = JSON.parse(saved);
      if (!validateState(value)) throw new Error("Invalid saved workspace");
      removeDefaults(value);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      storageBlocked = false;
      return value;
    }
    const value = emptyWorkspace();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    storageBlocked = false;
    return value;
  } catch {
    storageBlocked = true;
    workspaceError("Your saved workspace could not be opened. Your stored data has been kept. Check browser storage and reload to continue.");
    return emptyWorkspace();
  }
}
let state = loadState();
function activeServer() { return state.servers.find((server) => server.id === state.activeServerId); }
function activeChannel() { return activeServer()?.channels.find((channel) => channel.id === activeServer().activeChannelId); }
function updateState(change) {
  if (storageBlocked) return false;
  try {
    // Read the latest workspace so another tab's messages are preserved.
    const latest = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!validateState(latest)) throw new Error("Invalid workspace");
    change(latest);
    if (!validateState(latest)) throw new Error("Invalid update");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(latest));
    state = latest;
    workspaceError("");
    return true;
  } catch {
    workspaceError("Your changes could not be saved. Check that browser storage is available and has free space, then try again.");
    return false;
  }
}
function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join("").toUpperCase();
}
function closeSidebar() {
  sidebar.classList.remove("open");
  menuButton.setAttribute("aria-expanded", "false");
}
function renderMessages() {
  const serverId = state.activeServerId;
  const channel = activeChannel();
  messageList.replaceChildren();
  if (!channel) return;
  const messages = [...channel.messages].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const message of messages) {
    const own = message.authorId === currentUser.id;
    const item = node("li", `message${own ? " message-own" : ""}`);
    const avatar = node("span", "avatar", initials(message.authorName));
    avatar.setAttribute("aria-hidden", "true");
    const content = node("div", "message-content");
    const metadata = node("div", "message-meta");
    const time = node("time", "", new Date(message.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
    time.dateTime = message.createdAt;
    metadata.append(node("strong", "", `${message.authorName}${own ? " (You)" : ""}`), time);
    if (message.editedAt) metadata.append(node("span", "message-edited", "Edited"));
    if (own && !storageBlocked) {
      const options = node("button", "icon-button message-options", "⋯");
      options.type = "button";
      options.setAttribute("aria-label", "Message options");
      options.setAttribute("aria-haspopup", "menu");
      options.setAttribute("aria-expanded", "false");
      const openOptions = (event) => openContextMenu(event, serverId, options, channel.id, message.id);
      options.addEventListener("click", openOptions);
      options.addEventListener("keydown", (event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) openOptions(event);
      });
      item.addEventListener("contextmenu", openOptions);
      metadata.append(options);
    }
    content.append(metadata, node("p", "message-text", message.text));
    item.append(avatar, content);
    messageList.append(item);
  }
  messageList.scrollTop = messageList.scrollHeight;
}
const profileTrigger = $("#profile-trigger");
const profileMenu = $("#profile-menu");
const presenceTrigger = $("#profile-status-trigger");
const presencePicker = $("#profile-status-picker");
const presenceError = $("#presence-error");
const settingsTrigger = $("#open-profile-settings");
const settingsPopup = $("#settings-popup");
const accountSettings = $("#open-account-settings");
const accountPage = $("#account-page");
const appearancePage = $("#appearance-page");
const appearanceForm = $("#appearance-form");
const appearanceError = $("#appearance-error");
const profileForm = $("#profile-settings-form");
const profileError = $("#profile-settings-error");
const profileStatus = $("#profile-settings-status");
function renderProfile() {
  $("#profile-name").textContent = currentUser.name;
  $("#profile-menu-name").textContent = currentUser.name;
  $("#profile-avatar").textContent = initials(currentUser.name);
  $("#profile-menu-avatar").textContent = initials(currentUser.name);
  $("#account-avatar").textContent = initials(currentUser.name);
  $("#profile-menu-email").textContent = currentUser.email;
  $("#profile-menu-email").hidden = !currentUser.email;
}
function closeSettingsPopup(restoreFocus = false) {
  settingsPopup.hidden = true;
  settingsTrigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) settingsTrigger.focus();
}
function renderPresence() {
  const { label, icon } = presenceOptions[presence];
  const indicator = $("#profile-status-icon");
  indicator.textContent = icon;
  indicator.setAttribute("data-presence", presence);
  presenceTrigger.title = `Set status (currently ${label})`;
  $("#profile-current-status").textContent = `Set status. Current status: ${label}`;
  $(`#presence-${presence}`).checked = true;
}
function closePresencePicker(restoreFocus = false) {
  presencePicker.hidden = true;
  presenceTrigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) presenceTrigger.focus();
}
function closeProfileMenu(restoreFocus = false) {
  closePresencePicker();
  closeSettingsPopup();
  profileMenu.hidden = true;
  profileTrigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) profileTrigger.focus();
}
profileTrigger.addEventListener("click", () => {
  if (!profileMenu.hidden) {
    closeProfileMenu(true);
    return;
  }
  closeContextMenu();
  profileMenu.hidden = false;
  profileTrigger.setAttribute("aria-expanded", "true");
  presenceTrigger.focus();
});
document.addEventListener("pointerdown", (event) => {
  if (!$(".profile-area").contains(event.target)) closeProfileMenu();
});
document.addEventListener("focusin", (event) => {
  if (!$(".profile-area").contains(event.target)) closeProfileMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !profileMenu.hidden) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!presencePicker.hidden) closePresencePicker(true);
    else if (!settingsPopup.hidden) closeSettingsPopup(true);
    else closeProfileMenu(true);
  }
});
presenceTrigger.addEventListener("click", () => {
  if (!presencePicker.hidden) {
    closePresencePicker(true);
    return;
  }
  closeSettingsPopup();
  presenceError.textContent = "";
  presencePicker.hidden = false;
  presenceTrigger.setAttribute("aria-expanded", "true");
  $(`#presence-${presence}`).focus();
});
presencePicker.addEventListener("change", (event) => {
  const selected = event.target.value;
  if (!Object.hasOwn(presenceOptions, selected)) return;
  try {
    localStorage.setItem(PRESENCE_KEY, selected);
    presence = selected;
    presenceError.textContent = "";
  } catch {
    presenceError.textContent = "Could not save your status. Check browser storage and try again.";
  }
  renderPresence();
});
settingsTrigger.addEventListener("click", () => {
  if (!settingsPopup.hidden) {
    closeSettingsPopup(true);
    return;
  }
  closePresencePicker();
  settingsPopup.hidden = false;
  settingsTrigger.setAttribute("aria-expanded", "true");
  accountSettings.focus();
});
$("#close-settings-popup").addEventListener("click", () => closeSettingsPopup(true));
accountSettings.addEventListener("click", () => {
  $("#profile-display-name").value = currentUser.name;
  $("#profile-email").value = currentUser.email;
  $("#profile-designation").value = currentUser.designation;
  profileError.textContent = "";
  profileStatus.textContent = "";
  showSettingsPage(accountPage, $("#profile-settings-title"));
});
function showSettingsPage(page, heading) {
  closeProfileMenu();
  closeSidebar();
  accountPage.hidden = page !== accountPage;
  appearancePage.hidden = page !== appearancePage;
  chat.hidden = true;
  page.scrollTop = 0;
  heading.focus();
}
function closeSettingsPages() {
  accountPage.hidden = true;
  appearancePage.hidden = true;
  chat.hidden = false;
}
function exitSettingsPage() {
  closeSettingsPages();
  if (menuButton.getClientRects().length) menuButton.focus();
  else profileTrigger.focus();
}
$("#close-profile-settings").addEventListener("click", exitSettingsPage);
$("#close-appearance-settings").addEventListener("click", exitSettingsPage);
for (const page of [accountPage, appearancePage]) {
  page.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.defaultPrevented) exitSettingsPage();
  });
}
function loadAppearance() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(APPEARANCE_KEY));
  } catch { /* Use defaults if browser storage is unavailable or invalid. */ }
  return Object.fromEntries(Object.entries(appearanceOptions).map(([name, choices]) => [
    name, choices.includes(saved?.[name]) ? saved[name] : choices[0]
  ]));
}
let appearance = loadAppearance();
function renderAppearance() {
  for (const [name, value] of Object.entries(appearance)) {
    document.documentElement.dataset[name] = value;
    appearanceForm.elements[name].value = value;
  }
}
renderAppearance();
$("#open-appearance-settings").addEventListener("click", () => {
  appearanceError.textContent = "";
  showSettingsPage(appearancePage, $("#appearance-title"));
});
appearanceForm.addEventListener("submit", (event) => event.preventDefault());
appearanceForm.addEventListener("change", (event) => {
  const { name, value } = event.target;
  if (!Object.hasOwn(appearanceOptions, name) || !appearanceOptions[name].includes(value)) return;
  const next = { ...appearance, [name]: value };
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next));
    appearance = next;
    appearanceError.textContent = "";
  } catch {
    appearanceError.textContent = "Could not save your appearance settings. Check browser storage and try again.";
  }
  renderAppearance();
});
profileForm.addEventListener("input", () => {
  profileError.textContent = "";
  profileStatus.textContent = "";
});
profileForm.addEventListener("submit", (event) => {
  event.preventDefault();
  profileStatus.textContent = "";
  const name = $("#profile-display-name").value.trim();
  const email = $("#profile-email").value.trim();
  const designation = $("#profile-designation").value.trim();
  if (!name || name.length > 60 || email.length > 254 || !$("#profile-email").checkValidity()) {
    profileError.textContent = "Enter a name of 1–60 characters and a valid email address, or leave email blank.";
    return;
  }
  if (designation.length > MAX_DESIGNATION_LENGTH) {
    profileError.textContent = `Keep your work designation to ${MAX_DESIGNATION_LENGTH} characters or fewer.`;
    return;
  }
  try {
    const profile = { name, email, designation };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    Object.assign(currentUser, profile);
    renderProfile();
    profileError.textContent = "";
    profileStatus.textContent = "Profile updated.";
  } catch {
    profileError.textContent = "Could not save your profile. Check browser storage and try again.";
  }
});
renderProfile();
renderPresence();
let menuServerId = null;
let menuChannelId = null;
let menuMessageId = null;
let menuTrigger = null;
const serverInfoOption = $("#open-server-info");
const editMessageOption = $("#edit-message-option");
const deleteOption = $("#delete-entity");
const serverInfoDialog = $("#server-info-dialog");
const editMessageDialog = $("#edit-message-dialog");
const editMessageInput = $("#edit-message-input");
const editMessageError = $("#edit-message-error");
let editingMessage = null;
function closeContextMenu(restoreFocus = false) {
  $("#context-menu").hidden = true;
  menuServerId = null;
  menuChannelId = null;
  menuMessageId = null;
  if (menuTrigger) menuTrigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) menuTrigger?.focus();
  menuTrigger = null;
}
function openContextMenu(event, serverId, trigger, channelId = null, messageId = null) {
  event.preventDefault();
  closeProfileMenu();
  closeContextMenu();
  menuServerId = serverId;
  menuChannelId = channelId;
  menuMessageId = messageId;
  const entity = messageId !== null ? "message" : channelId !== null ? "channel" : "server";
  serverInfoOption.hidden = channelId !== null;
  editMessageOption.hidden = messageId === null;
  deleteOption.textContent = `Delete ${entity}`;
  deleteOption.disabled = storageBlocked;
  $("#context-menu").setAttribute("aria-label", `${entity[0].toUpperCase()}${entity.slice(1)} options`);
  menuTrigger = trigger;
  trigger.setAttribute("aria-expanded", "true");
  const menu = $("#context-menu");
  menu.hidden = false;
  const rect = trigger.getBoundingClientRect();
  const keyboard = event.type === "keydown" || (!event.clientX && !event.clientY);
  const x = keyboard ? rect.left : event.clientX;
  const y = keyboard ? rect.bottom : event.clientY;
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
  contextMenuItems()[0]?.focus();
}
function contextMenuItems() {
  return [serverInfoOption, editMessageOption, deleteOption].filter((item) => !item.hidden && !item.disabled);
}
function messageChannel(workspace, { serverId, channelId }) {
  return workspace.servers.find((server) => server.id === serverId)
    ?.channels.find((channel) => channel.id === channelId);
}
function updateOwnMessage(target, change) {
  let changed = false;
  const saved = updateState((latest) => {
    const channel = messageChannel(latest, target);
    const index = channel?.messages.findIndex((message) =>
      message.id === target.messageId && message.authorId === currentUser.id) ?? -1;
    if (index >= 0) changed = change(channel.messages, index);
  });
  if (!saved) return "Could not save your changes. Check browser storage and try again.";
  if (!changed) return "This message was changed or removed. Reopen its options to try again.";
  return "";
}
function deleteServer(serverId) {
  const server = state.servers.find((entry) => entry.id === serverId);
  if (storageBlocked || !server || !window.confirm(`Delete server “${server.name}” and all its channels and messages? This cannot be undone.`)) return;
  if (updateState((next) => {
    next.servers = next.servers.filter((entry) => entry.id !== serverId);
    if (next.activeServerId === serverId) next.activeServerId = next.servers[0]?.id ?? null;
  })) {
    render();
    $("#add-server").focus();
    $("#message-status").textContent = `Server ${server.name} deleted.`;
  }
}
function deleteChannel(serverId, channelId) {
  const server = state.servers.find((entry) => entry.id === serverId);
  const channel = server?.channels.find((entry) => entry.id === channelId);
  if (storageBlocked || !channel || !window.confirm(`Delete channel #${channel.name} and all its messages? This cannot be undone.`)) return;
  if (updateState((next) => {
    const target = next.servers.find((entry) => entry.id === serverId);
    if (!target) return;
    target.channels = target.channels.filter((entry) => entry.id !== channelId);
    if (target.activeChannelId === channelId) target.activeChannelId = target.channels[0]?.id ?? null;
  })) {
    render();
    $("#add-channel").focus();
    $("#message-status").textContent = `Channel ${channel.name} deleted.`;
  }
}
function render() {
  closeContextMenu();
  const server = activeServer();
  const channel = activeChannel();
  $("#server-list").replaceChildren(...state.servers.map((entry) => {
    const button = node("button", `server-icon${entry.id === server?.id ? " active" : ""}`, entry.name);
    button.type = "button";
    button.title = entry.name;
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("contextmenu", (event) => openContextMenu(event, entry.id, button));
    button.addEventListener("keydown", (event) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) openContextMenu(event, entry.id, button);
    });
    button.setAttribute("aria-label", entry.name);
    button.setAttribute("aria-pressed", String(entry.id === server?.id));
    button.addEventListener("click", () => {
      if (updateState((next) => { next.activeServerId = entry.id; })) {
        closeSettingsPages();
        render();
        $("#message-status").textContent = `Switched to ${entry.name}.`;
      }
    });
    return button;
  }));
  $("#server-name").textContent = server?.name ?? "";
  $("#server-description").textContent = "";
  $("#channel-list").replaceChildren(...(server?.channels ?? []).map((entry) => {
    const button = node("button", `channel-button${entry.id === channel?.id ? " active" : ""}`);
    button.type = "button";
    const hash = node("span", "hash", "#");
    hash.setAttribute("aria-hidden", "true");
    button.append(hash, node("span", "", entry.name));
    if (entry.id === channel?.id) button.setAttribute("aria-current", "page");
    button.addEventListener("click", () => {
      if (updateState((next) => { next.servers.find((s) => s.id === server.id).activeChannelId = entry.id; })) {
        closeSettingsPages();
        render(); closeSidebar(); messageInput.focus();
      }
    });
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("contextmenu", (event) => openContextMenu(event, server.id, button, entry.id));
    button.addEventListener("keydown", (event) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) openContextMenu(event, server.id, button, entry.id);
    });
    return button;
  }));
  chat.setAttribute("aria-label", channel ? `Chat: ${channel.name}` : "Chat");
  $("#composer-label").textContent = channel ? `#${channel.name}` : "";
  messageInput.placeholder = channel ? `Message #${channel.name}…` : "";
  messageInput.value = channel?.draft ?? "";
  messageForm.style.visibility = channel ? "visible" : "hidden";
  messageForm.setAttribute("aria-hidden", String(!channel));
  messageForm.inert = !channel;
  messageInput.disabled = storageBlocked || !channel;
  $("#add-server").disabled = storageBlocked;
  const channelNavigation = $(".channel-navigation");
  channelNavigation.style.visibility = server ? "visible" : "hidden";
  channelNavigation.setAttribute("aria-hidden", String(!server));
  channelNavigation.inert = !server;
  $("#add-channel").disabled = storageBlocked || !server;
  messageForm.querySelector("button").disabled = storageBlocked || !channel;
  $("#message-error").textContent = "";
  renderMessages();
  document.title = channel ? `${server.name} · #${channel.name} | TeamConnect` : server ? `${server.name} | TeamConnect` : "TeamConnect";
}
function openCreate(mode) {
  if (mode === "channel" && !activeServer()) return;
  dialogMode = mode;
  const isServer = mode === "server";
  $("#create-form").reset();
  $("#dialog-title").textContent = isServer ? "Create a server" : "Create a channel";
  $("#dialog-description").textContent = "";
  $("#entity-label").textContent = isServer ? "Server name" : "Channel name";
  const nameInput = $("#entity-name");
  nameInput.placeholder = "";
  if (isServer) nameInput.removeAttribute("maxlength");
  else nameInput.maxLength = 60;
  $("#dialog-hint").textContent = "";
  $("#create-submit").textContent = `Create ${mode}`;
  $("#dialog-error").textContent = "";
  dialog.showModal();
  $("#entity-name").focus();
}
serverInfoOption.addEventListener("click", () => {
  const server = state.servers.find((entry) => entry.id === menuServerId);
  if (!server || menuChannelId !== null) return;
  closeContextMenu(true);
  const createdAt = typeof server.createdAt === "string" ? Date.parse(server.createdAt) : NaN;
  $("#server-info-name").textContent = server.name;
  $("#server-info-creator").textContent = typeof server.createdBy === "string" && server.createdBy.trim()
    ? server.createdBy
    : "Unavailable";
  $("#server-info-created").textContent = Number.isFinite(createdAt)
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(createdAt)
    : "Unavailable";
  $("#server-info-channels").textContent = server.channels.length.toLocaleString();
  $("#server-info-messages").textContent = server.channels
    .reduce((total, channel) => total + channel.messages.length, 0).toLocaleString();
  serverInfoDialog.showModal();
});
$("#close-server-info").addEventListener("click", () => serverInfoDialog.close());
editMessageOption.addEventListener("click", () => {
  const target = { serverId: menuServerId, channelId: menuChannelId, messageId: menuMessageId };
  const message = messageChannel(state, target)?.messages.find((entry) =>
    entry.id === target.messageId && entry.authorId === currentUser.id);
  if (!message) return;
  closeContextMenu(true);
  editingMessage = { ...target, text: message.text, editedAt: message.editedAt };
  editMessageInput.value = message.text;
  editMessageError.textContent = "";
  editMessageDialog.showModal();
});
$("#cancel-message-edit").addEventListener("click", () => editMessageDialog.close());
editMessageDialog.addEventListener("close", () => {
  if (!editMessageDialog.open) editingMessage = null;
});
editMessageInput.addEventListener("input", () => { editMessageError.textContent = ""; });
$("#edit-message-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!editingMessage) return;
  const text = editMessageInput.value.trim();
  if (!text || text.length > MAX_MESSAGE_LENGTH) {
    editMessageError.textContent = "Enter a message of 1–2,000 characters.";
    editMessageInput.focus();
    return;
  }
  const error = updateOwnMessage(editingMessage, (messages, index) => {
    const message = messages[index];
    if (message.text !== editingMessage.text || message.editedAt !== editingMessage.editedAt) return false;
    if (message.text !== text) {
      message.text = text;
      message.editedAt = new Date().toISOString();
    }
    return true;
  });
  if (error) {
    editMessageError.textContent = error;
    return;
  }
  editMessageDialog.close();
  refreshAfterMessageChange("Message saved.");
});
function refreshAfterMessageChange(status) {
  const scrollTop = messageList.scrollTop;
  render();
  messageList.scrollTop = scrollTop;
  messageInput.focus({ preventScroll: true });
  $("#message-status").textContent = status;
}
deleteOption.addEventListener("click", () => {
  const serverId = menuServerId;
  const channelId = menuChannelId;
  const messageId = menuMessageId;
  closeContextMenu(true);
  if (messageId !== null) {
    if (!window.confirm("Delete this message? This cannot be undone.")) return;
    const error = updateOwnMessage({ serverId, channelId, messageId }, (messages, index) => {
      messages.splice(index, 1);
      return true;
    });
    if (error) $("#message-error").textContent = error;
    else refreshAfterMessageChange("Message deleted.");
  } else if (channelId) {
    deleteChannel(serverId, channelId);
  } else {
    deleteServer(serverId);
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!$("#context-menu").contains(event.target)) closeContextMenu();
});
document.addEventListener("keydown", (event) => {
  if ($("#context-menu").hidden) return;
  if (event.key === "Escape" || event.key === "Tab") {
    if (event.key === "Escape") event.preventDefault();
    closeContextMenu(true);
    return;
  }
  const items = contextMenuItems();
  if (!items.length || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const current = items.indexOf(document.activeElement);
  if (event.key === "Home") items[0].focus();
  else if (event.key === "End") items.at(-1).focus();
  else if (event.key === "ArrowDown") items[(current + 1) % items.length].focus();
  else items[(current <= 0 ? items.length : current) - 1].focus();
});
window.addEventListener("resize", () => closeContextMenu());
document.addEventListener("scroll", () => closeContextMenu(), true);
$("#add-server").addEventListener("click", () => openCreate("server"));
$("#add-channel").addEventListener("click", () => openCreate("channel"));
$("#cancel-dialog").addEventListener("click", () => dialog.close());
$("#close-dialog").addEventListener("click", () => dialog.close());
$("#create-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const isChannel = dialogMode === "channel";
  let name = $("#entity-name").value.trim();
  if (isChannel) name = name.toLowerCase().replace(/\s+/g, "-");
  if (!name || (isChannel && (name.length > 60 || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(name)))) {
    $("#dialog-error").textContent = isChannel ? "Enter a channel name using letters, numbers, and single hyphens." : "Enter a server name.";
    return;
  }
  const serverId = activeServer()?.id;
  let duplicate = false;
  const saved = updateState((next) => {
    if (!isChannel) {
      const created = makeServer(name);
      next.servers.push(created); next.activeServerId = created.id;
    } else {
      const server = next.servers.find((s) => s.id === serverId);
      if (server.channels.some((entry) => entry.name.toLowerCase() === name)) {
        duplicate = true;
        return;
      }
      const channel = makeChannel(name);
      server.channels.push(channel); server.activeChannelId = channel.id;
    }
  });
  if (duplicate) { $("#dialog-error").textContent = "A channel with this name already exists."; return; }
  if (!saved) { $("#dialog-error").textContent = "Could not save. Check your browser storage and try again."; return; }
  dialog.close(); closeSettingsPages(); render(); closeSidebar(); messageInput.focus();
  $("#message-status").textContent = `${dialogMode === "server" ? "Server" : "Channel"} ${name} created.`;
});
messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!activeChannel()) return;
  const text = messageInput.value.trim();
  if (!text || text.length > MAX_MESSAGE_LENGTH) {
    $("#message-error").textContent = "Enter a message of 1–2,000 characters.";
    messageInput.focus(); return;
  }
  const channelId = activeChannel().id;
  const serverId = activeServer()?.id;
  if (updateState((next) => {
    const channel = next.servers.find((s) => s.id === serverId).channels.find((c) => c.id === channelId);
    channel.messages.push({ id: id(), authorId: currentUser.id, authorName: currentUser.name, text, createdAt: new Date().toISOString() });
    channel.draft = "";
  })) {
    render(); $("#message-status").textContent = "Message sent."; messageInput.focus();
  }
});
messageInput.addEventListener("input", () => {
  if (!activeChannel()) return;
  $("#message-error").textContent = ""; $("#message-status").textContent = "";
  const channelId = activeChannel().id;
  const serverId = activeServer()?.id;
  updateState((next) => {
    next.servers.find((s) => s.id === serverId).channels.find((c) => c.id === channelId).draft = messageInput.value;
  });
});
messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); messageForm.requestSubmit(); }
});
menuButton.addEventListener("click", () => {
  const open = sidebar.classList.toggle("open"); menuButton.setAttribute("aria-expanded", String(open));
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && sidebar.classList.contains("open") && !dialog.open) { closeSidebar(); menuButton.focus(); }
});
window.addEventListener("storage", (event) => {
  if (event.key === APPEARANCE_KEY || event.key === null) {
    appearance = loadAppearance();
    renderAppearance();
  }
  if (event.key === STORAGE_KEY || event.key === null) {
    state = loadState();
    if (!storageBlocked) workspaceError("");
    render();
  }
});
render();
