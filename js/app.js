const STORAGE_KEY = "teamconnect.workspace.v1";
const MAX_MESSAGE_LENGTH = 2000;
const PASSWORD_KEY = "teamconnect.password.v1";
const PROFILE_KEY = "teamconnect.profile.v1";
const PRESENCE_KEY = "teamconnect.presence";
const APPEARANCE_KEY = "teamconnect.appearance.v1";
const DEMO_SESSION_KEY = "teamconnect.demo-session.v2";
const ADMIN_ID = "user-arnav";
const demoUsers = {
  "user-arnav": { name: "Admin", email: "Admin@gmail.com", role: "Workspace Admin",
    salt: "271ee78fb99a5f6e7d4289e943726432", digest: "b56b6ac80ea30c16d9112af12def68cd07ecfa46f902a355c5a7caf1d446b1ee" },
  "employee-arnav": { name: "Arnav Shaw", email: "arnavshaw@gmail.com", role: "Employee",
    salt: "931068b51fdad6436b1a1c92e319b3f1", digest: "060b5afc60df6c7faa7f76cf0d03fc131fa6fed6923228f8749cb7022796685f" },
  "employee-parth": { name: "Parth Singhal", email: "parthsinghal@gmail.com", role: "Employee",
    salt: "e240bd8fbe4716a7f690bb6a297549c2", digest: "04b35b6533a38717f8fd96c1cbef23d725bc088e249910a5bb1ed44495f2cab3" }
};
const MAX_PHOTO_SIZE = 256 * 1024;
const photoTypes = ["image/png", "image/jpeg", "image/webp"];
const photoData = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
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
const MAX_DESIGNATION_LENGTH = 80;
function scopedKey(key, userId) {
  return userId === ADMIN_ID ? key : `${key}.${userId}`;
}
function loadUser(userId) {
  if (!Object.hasOwn(demoUsers, userId)) return null;
  const user = { id: userId, name: demoUsers[userId].name, role: demoUsers[userId].role, email: demoUsers[userId].email, designation: "", photo: "" };
  try {
    const profile = JSON.parse(localStorage.getItem(scopedKey(PROFILE_KEY, userId)));
    if (typeof profile?.name === "string" && profile.name.trim() && profile.name.length <= 60) user.name = profile.name.trim();
    if (typeof profile?.email === "string" && profile.email.length <= 254) user.email = profile.email;
    if (typeof profile?.designation === "string" && profile.designation.length <= MAX_DESIGNATION_LENGTH) {
      user.designation = profile.designation;
    }
    if (typeof profile?.photo === "string" && profile.photo.length <= 4 * Math.ceil(MAX_PHOTO_SIZE / 3) + 24 && photoData.test(profile.photo)) {
      user.photo = profile.photo;
    }
  } catch { /* Keep the demo profile if browser storage is unavailable. */ }
  return user;
}
let userId = null;
try {
  userId = sessionStorage.getItem(DEMO_SESSION_KEY);
} catch { /* Sign in again when session storage is unavailable. */ }
let currentUser = loadUser(userId);
function isAdmin() { return currentUser?.id === ADMIN_ID; }
function loadPresence(userId = currentUser?.id) {
  try {
    const saved = userId && localStorage.getItem(scopedKey(PRESENCE_KEY, userId));
    if (Object.hasOwn(presenceOptions, saved)) return saved;
  } catch { /* Use the default status if browser storage is unavailable. */ }
  return "active";
}
let presence = loadPresence();
const $ = (selector) => document.querySelector(selector);
const messageInput = $("#message-input");
const messageList = $("#message-list");
const messageForm = $("#message-form");
const chat = $(".chat");
const sidebar = $("#sidebar");
const menuButton = $("#menu-button");
const dialog = $("#create-dialog");
let dialogMode = "server";
let createServerId = null;
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
    memberIds: [ADMIN_ID],
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
  if (!value || !validAdminData(value) || value.version !== 1 || !Array.isArray(value.servers)) return false;
  const ids = new Set();
  const unique = (value) => {
    if (typeof value !== "string" || !value || ids.has(value)) return false;
    ids.add(value);
    return true;
  };
  return value.servers.every((server) => server && unique(server.id) &&
    typeof server.name === "string" && server.name.trim() && Array.isArray(server.channels) &&
    (server.memberIds === undefined || (Array.isArray(server.memberIds) && server.memberIds.includes(ADMIN_ID) &&
      server.memberIds.every(id => Object.hasOwn(demoUsers, id)) && new Set(server.memberIds).size === server.memberIds.length)) &&
    server.channels.every((channel) => channel && unique(channel.id) && typeof channel.name === "string" && channel.name.trim() &&
      (channel.archived === undefined || typeof channel.archived === "boolean") &&
      (channel.drafts === undefined || (channel.drafts && typeof channel.drafts === "object" &&
        !Array.isArray(channel.drafts) && Object.values(channel.drafts).every(text => typeof text === "string"))) &&
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
function memberIds(server) {
  // Before membership was stored, every account could access every server.
  return server.memberIds ?? Object.keys(demoUsers);
}
function canAccess(server) {
  return Boolean(server && currentUser && memberIds(server).includes(currentUser.id));
}
function activeServer() {
  return state.servers.find(server => server.id === state.activeServerId && canAccess(server)) ?? state.servers.find(canAccess);
}
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
function renderAvatar(avatar, name, photo) {
  avatar.textContent = initials(name);
  if (photo) {
    const image = node("img");
    image.alt = "";
    image.addEventListener("error", () => { avatar.textContent = initials(name); });
    image.src = photo;
    avatar.replaceChildren(image);
  }
}
function closeSidebar() {
  sidebar.classList.remove("open");
  menuButton.setAttribute("aria-expanded", "false");
}
function renderMessages() {
  const serverId = activeServer()?.id;
  const channel = activeChannel();
  messageList.replaceChildren();
  if (!channel || !currentUser) return;
  const profiles = new Map(Object.keys(demoUsers).map((id) => [id, id === currentUser.id ? currentUser : loadUser(id)]));
  const messages = [...channel.messages].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const message of messages) {
    const own = message.authorId === currentUser.id;
    const item = node("li", `message${own ? " message-own" : ""}`);
    const avatar = node("span", "avatar");
    const author = profiles.get(message.authorId);
    const authorName = author?.name ?? message.authorName;
    renderAvatar(avatar, authorName, author?.photo);
    avatar.setAttribute("aria-hidden", "true");
    const content = node("div", "message-content");
    const metadata = node("div", "message-meta");
    const time = node("time", "", new Date(message.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
    time.dateTime = message.createdAt;
    metadata.append(node("strong", "", `${authorName}${own ? " (You)" : ""}`), time);
    if (message.editedAt && !message.removedBy) metadata.append(node("span", "message-edited", "Edited"));
    if ((own || isAdmin()) && !storageBlocked && !channel.archived && !message.removedBy) {
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
    content.append(metadata, node("p", message.removedBy ? "message-text message-removed" : "message-text",
      message.removedBy ? "Removed by an admin." : message.text));
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
const themeTrigger = $("#open-theme-settings");
const themePanel = $("#theme-panel");
const themeError = $("#theme-error");
const profileForm = $("#profile-settings-form");
const profileError = $("#profile-settings-error");
const profileStatus = $("#profile-settings-status");
const photoInput = $("#profile-photo");
const removePhotoButton = $("#remove-profile-photo");
const saveProfileButton = $("#save-profile");
let removePhoto = false;
function renderProfile() {
  $("#profile-name").textContent = currentUser.name;
  $("#profile-menu-name").textContent = currentUser.name;
  for (const selector of ["#profile-avatar", "#profile-menu-avatar", "#account-avatar"]) {
    renderAvatar($(selector), currentUser.name, currentUser.photo);
  }
  $("#profile-menu-email").textContent = currentUser.email;
  $("#profile-menu-email").hidden = !currentUser.email;
  $("#account-role").textContent = currentUser.role;
}
function closeSettingsPopup(restoreFocus = false) {
  closeThemePanel();
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
    else if (!themePanel.hidden) closeThemePanel(true);
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
  if (!currentUser || !Object.hasOwn(presenceOptions, selected)) return;
  try {
    localStorage.setItem(scopedKey(PRESENCE_KEY, currentUser.id), selected);
    presence = selected;
    presenceError.textContent = "";
  } catch {
    presenceError.textContent = "Could not save your status. Check browser storage and try again.";
  }
  renderPresence();
  refreshMemberStatuses(scopedKey(PRESENCE_KEY, currentUser.id));
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
  photoInput.value = "";
  removePhoto = false;
  renderPhotoControls();
  profileError.textContent = "";
  profileStatus.textContent = "";
  showSettingsPage(accountPage, $("#profile-settings-title"));
});
function showSettingsPage(page, heading) {
  closeProfileMenu();
  closeSidebar();
  $("#admin-page").hidden = page !== $("#admin-page");
  accountPage.hidden = page !== accountPage;
  chat.hidden = true;
  page.scrollTop = 0;
  heading.focus();
}
function closeSettingsPages() {
  $("#admin-page").hidden = true;
  $("#change-password-form")?.remove();
  $("#help-request-form")?.remove();
  accountPage.hidden = true;
  chat.hidden = false;
}
function exitSettingsPage() {
  closeSettingsPages();
  if (menuButton.getClientRects().length) menuButton.focus();
  else profileTrigger.focus();
}
$("#close-profile-settings").addEventListener("click", exitSettingsPage);
for (const page of [accountPage, $("#admin-page")]) {
  page.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.defaultPrevented) exitSettingsPage();
  });
}
function loadAppearance() {
  let saved;
  try {
    if (currentUser) saved = JSON.parse(localStorage.getItem(scopedKey(APPEARANCE_KEY, currentUser.id)));
  } catch { /* Use defaults if browser storage is unavailable or invalid. */ }
  return Object.fromEntries(Object.entries(appearanceOptions).map(([name, choices]) => [
    name, choices.includes(saved?.[name]) ? saved[name] : choices[0]
  ]));
}
let appearance = loadAppearance();
function renderAppearance() {
  for (const [name, value] of Object.entries(appearance)) {
    document.documentElement.dataset[name] = value;
  }
  for (const option of themePanel.querySelectorAll("input")) option.checked = option.value === appearance.theme;
}
renderAppearance();
function closeThemePanel(restoreFocus = false) {
  themePanel.hidden = true;
  themeTrigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) themeTrigger.focus();
}
themeTrigger.addEventListener("click", () => {
  if (!themePanel.hidden) {
    closeThemePanel(true);
    return;
  }
  themeError.textContent = "";
  themePanel.hidden = false;
  themeTrigger.setAttribute("aria-expanded", "true");
  themePanel.querySelector(":checked")?.focus();
});
themePanel.addEventListener("change", event => {
  const { value } = event.target;
  if (!currentUser || !appearanceOptions.theme.includes(value)) return;
  const next = { ...loadAppearance(), theme: value };
  try {
    localStorage.setItem(scopedKey(APPEARANCE_KEY, currentUser.id), JSON.stringify(next));
    appearance = next;
    themeError.textContent = "";
  } catch {
    themeError.textContent = "Could not save your theme. Check browser storage and try again.";
  }
  renderAppearance();
});
profileForm.addEventListener("input", () => {
  profileError.textContent = "";
  profileStatus.textContent = "";
});
function renderPhotoControls() {
  removePhotoButton.hidden = removePhoto || (!currentUser.photo && !photoInput.files.length);
  renderAvatar($("#account-avatar"), currentUser.name, removePhoto ? "" : currentUser.photo);
}
photoInput.addEventListener("change", () => {
  if (photoInput.files.length) {
    removePhoto = false;
    profileStatus.textContent = "Save changes to apply your photo.";
  }
  renderPhotoControls();
});
removePhotoButton.addEventListener("click", () => {
  photoInput.value = "";
  removePhoto = Boolean(currentUser.photo);
  renderPhotoControls();
  profileError.textContent = "";
  profileStatus.textContent = removePhoto ? "Save changes to remove your photo." : "";
  photoInput.focus();
});
async function readProfilePhoto(file) {
  const image = await createImageBitmap(file);
  image.close();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (photoData.test(reader.result)) resolve(reader.result);
      else reject(new Error("Unsupported photo data"));
    });
    reader.addEventListener("error", reject);
    reader.readAsDataURL(file);
  });
}
profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser || saveProfileButton.disabled) return;
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
  const user = currentUser;
  const file = photoInput.files[0];
  let photo = removePhoto ? "" : user.photo;
  if (file) {
    if (!photoTypes.includes(file.type) || file.size > MAX_PHOTO_SIZE) {
      profileError.textContent = "Choose a PNG, JPEG or WebP photo of 256 KB or less.";
      return;
    }
    const fields = profileForm.querySelector(".account-fields");
    fields.inert = true;
    saveProfileButton.disabled = true;
    try {
      photo = await readProfilePhoto(file);
    } catch {
      if (user === currentUser) profileError.textContent = "This photo could not be opened. Choose a different image.";
      return;
    } finally {
      fields.inert = false;
      saveProfileButton.disabled = false;
    }
  }
  if (user !== currentUser) return;
  try {
    const profile = { name, email, designation, photo };
    localStorage.setItem(scopedKey(PROFILE_KEY, user.id), JSON.stringify(profile));
    Object.assign(currentUser, profile);
    photoInput.value = "";
    removePhoto = false;
    renderProfile();
    renderPhotoControls();
    renderMessages();
    profileError.textContent = "";
    profileStatus.textContent = "Profile updated.";
  } catch {
    profileError.textContent = "Could not save your profile. Check browser storage and try again.";
  }
});
function renderSession() {
  $(".workspace").hidden = !currentUser;
  $("#demo-sign-in").hidden = Boolean(currentUser);
  appearance = loadAppearance();
  renderAppearance();
  if (currentUser) {
    presence = loadPresence();
    renderProfile();
    renderPresence();
  }
  render();
}
function changeSession(user) {
  currentUser = user;
  try {
    sessionStorage.setItem(DEMO_SESSION_KEY, user?.id ?? "signed-out");
  } catch { /* The demo still works until the page reloads. */ }
  closeProfileMenu();
  closeSettingsPages();
  closeSidebar();
  for (const modal of [dialog, serverInfoDialog, editMessageDialog, addMemberDialog]) {
    if (modal.open) modal.close();
  }
  renderSession();
  if (user) (menuButton.getClientRects().length ? menuButton : profileTrigger).focus();
  else $("#demo-sign-in-title").focus();
}
function passwordCredentials(userId) {
  const saved = localStorage.getItem(scopedKey(PASSWORD_KEY, userId));
  if (saved === null) return demoUsers[userId];
  const credentials = JSON.parse(saved);
  if (!/^[a-f0-9]{32}$/.test(credentials?.salt) || !/^[a-f0-9]{64}$/.test(credentials?.digest)) {
    throw new Error("Invalid saved credential");
  }
  return credentials;
}

function hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function passwordDigest(password, salt) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 600000
  }, key, 256);
  return hex(new Uint8Array(bits));
}

$("#log-out").addEventListener("click", () => changeSession(null));
$("#demo-sign-in-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = $("#sign-in-submit");
  if (currentUser || submit.disabled) return;
  const email = $("#demo-account").value.trim().toLowerCase();
  const password = $("#sign-in-password");
  const error = $("#sign-in-error");
  submit.disabled = true;
  error.textContent = "";
  try {
    const match = Object.entries(demoUsers).find(([, account]) => account.email.toLowerCase() === email);
    if (match) {
      const [id] = match;
      const account = passwordCredentials(id);
      if (await passwordDigest(password.value, account.salt) === account.digest &&
          passwordCredentials(id).digest === account.digest) {
        password.value = "";
        changeSession(loadUser(id));
        return;
      }
    }
    error.textContent = "The email or password is incorrect.";
    password.focus();
  } catch {
    error.textContent = "Password verification is unavailable. Check browser storage and open TeamConnect using HTTPS or localhost.";
  } finally {
    submit.disabled = false;
  }
});
let menuServerId = null;
let menuChannelId = null;
let menuMessageId = null;
let menuTrigger = null;
const managementOption = $("#open-workspace-management");
const serverInfoOption = $("#open-server-info");
const editMessageOption = $("#edit-message-option");
const archiveChannelOption = $("#archive-channel-option");
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
  if (!currentUser) return;
  const channel = messageChannel(state, { serverId, channelId });
  const message = channel?.messages.find((entry) => entry.id === messageId);
  if (messageId !== null && (!message || channel.archived || message.removedBy ||
    (!isAdmin() && message.authorId !== currentUser.id))) return;
  if (messageId === null && channelId !== null && (!channel || !isAdmin())) return;
  closeProfileMenu();
  closeContextMenu();
  menuServerId = serverId;
  menuChannelId = channelId;
  menuMessageId = messageId;
  const entity = messageId !== null ? "message" : channelId !== null ? "channel" : "server";
  serverInfoOption.hidden = channelId !== null;
  managementOption.hidden = !isAdmin() || entity !== "server";
  editMessageOption.hidden = !message || message.authorId !== currentUser.id;
  archiveChannelOption.hidden = !isAdmin() || !channel || Boolean(message);
  archiveChannelOption.disabled = storageBlocked;
  archiveChannelOption.textContent = channel?.archived ? "Restore channel" : "Archive channel";
  deleteOption.hidden = !message && !isAdmin();
  deleteOption.textContent = message && message.authorId !== currentUser.id ? "Remove message as admin" : `Delete ${entity}`;
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
  return [serverInfoOption, managementOption, editMessageOption, archiveChannelOption, deleteOption].filter((item) => !item.hidden && !item.disabled);
}
function messageChannel(workspace, { serverId, channelId }) {
  return workspace.servers.find((server) => server.id === serverId && canAccess(server))
    ?.channels.find((channel) => channel.id === channelId);
}
function changeMessage(target, change, allowModeration = false) {
  if (!currentUser) return "Sign in to change messages.";
  let changed = false;
  const saved = updateState((latest) => {
    const channel = messageChannel(latest, target);
    if (!channel || channel.archived) return;
    const index = channel.messages.findIndex((message) =>
      message.id === target.messageId && !message.removedBy &&
      (message.authorId === currentUser.id || (allowModeration && isAdmin())));
    if (index >= 0) {
      changed = change(channel.messages, index);
      if (changed && allowModeration) recordEvent(latest, serverFor(latest, target.serverId), "Moderation", "Removed a message in #" + channel.name);
    }
  });
  if (!saved) return "Could not save your changes. Check browser storage and try again.";
  if (!changed) return "This message was changed or removed. Reopen its options to try again.";
  return "";
}
function deleteServer(serverId) {
  const server = state.servers.find((entry) => entry.id === serverId);
  if (!isAdmin() || storageBlocked || !server || !window.confirm(`Delete server “${server.name}” and all its channels and messages? This cannot be undone.`)) return;
  if (updateState((next) => {
    recordEvent(next, server, "Servers", "Deleted server");
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
  if (!isAdmin() || storageBlocked || !channel || !window.confirm(`Delete channel #${channel.name} and all its messages? This cannot be undone.`)) return;
  if (updateState((next) => {
    const target = next.servers.find((entry) => entry.id === serverId);
    if (!target) return;
    recordEvent(next, target, "Channels", "Deleted #" + channel.name);
    target.channels = target.channels.filter((entry) => entry.id !== channelId);
    if (target.activeChannelId === channelId) target.activeChannelId = target.channels[0]?.id ?? null;
  })) {
    render();
    $("#add-channel").focus();
    $("#message-status").textContent = `Channel ${channel.name} deleted.`;
  }
}
archiveChannelOption.addEventListener("click", () => {
  if (!isAdmin() || storageBlocked) return;
  const target = { serverId: menuServerId, channelId: menuChannelId };
  const channel = messageChannel(state, target);
  closeContextMenu(true);
  if (channel) setChannelArchived(target.serverId, target.channelId, !channel.archived);
});
function setChannelArchived(serverId, channelId, archive) {
  const target = { serverId, channelId };
  const channel = messageChannel(state, target);
  if (!isAdmin() || !channel) return;
  if (archive && !window.confirm(`Archive #${channel.name} and make it read-only?`)) return;
  if (updateState((latest) => {
    const savedChannel = messageChannel(latest, target);
    if (savedChannel && Boolean(savedChannel.archived) !== archive) {
      savedChannel.archived = archive;
      recordEvent(latest, serverFor(latest, target.serverId), "Channels", (archive ? "Archived #" : "Restored #") + savedChannel.name);
    }
  })) {
    render();
    $("#message-status").textContent = archive ? "Channel archived." : "Channel restored.";
    $("#channel-list").children[activeServer()?.channels.findIndex((entry) => entry.id === channel.id)]?.focus();
  }
}
function render() {
  refreshAdminSettings();
  closeContextMenu();
  if (serverInfoDialog.open) renderServerInfo();
  if (editMessageDialog.open && editingMessage && !messageChannel(state, editingMessage)) editMessageDialog.close();
  const server = activeServer();
  const channel = activeChannel();
  $("#server-list").replaceChildren(...state.servers.filter(canAccess).map((entry) => {
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
  $("#channel-list").replaceChildren(...(server?.channels ?? []).map((entry) => {
    const button = node("button", `channel-button${entry.id === channel?.id ? " active" : ""}`);
    button.type = "button";
    const hash = node("span", "hash", "#");
    hash.setAttribute("aria-hidden", "true");
    button.append(hash, node("span", "", entry.name));
    if (entry.archived) button.append(node("small", "channel-archived", "Archived"));
    if (entry.id === channel?.id) button.setAttribute("aria-current", "page");
    button.addEventListener("click", () => {
      if (updateState((next) => { next.servers.find((s) => s.id === server.id).activeChannelId = entry.id; })) {
        closeSettingsPages();
        render(); closeSidebar(); messageInput.focus();
      }
    });
    if (isAdmin()) {
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("contextmenu", (event) => openContextMenu(event, server.id, button, entry.id));
      button.addEventListener("keydown", (event) => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) openContextMenu(event, server.id, button, entry.id);
      });
    }
    return button;
  }));
  chat.setAttribute("aria-label", channel ? `Chat: ${channel.name}` : "Chat");
  $("#composer-label").textContent = channel ? `#${channel.name}` : "";
  messageInput.placeholder = channel ? `Message #${channel.name}…` : "";
  messageInput.value = (isAdmin() ? channel?.draft : channel?.drafts?.[currentUser?.id]) ?? "";
  messageForm.style.visibility = channel ? "visible" : "hidden";
  messageForm.setAttribute("aria-hidden", String(!channel));
  messageForm.inert = !channel;
  messageInput.disabled = storageBlocked || !currentUser || !channel || Boolean(channel.archived);
  $("#archived-channel-note").hidden = !channel?.archived;
  $("#add-server").hidden = !isAdmin();
  $("#add-server").disabled = storageBlocked;
  const channelNavigation = $(".channel-navigation");
  channelNavigation.style.visibility = server ? "visible" : "hidden";
  channelNavigation.setAttribute("aria-hidden", String(!server));
  channelNavigation.inert = !server;
  $("#add-channel").hidden = !isAdmin();
  $("#add-channel").disabled = storageBlocked || !server;
  messageForm.querySelector("button").disabled = messageInput.disabled;
  $("#message-error").textContent = "";
  renderMessages();
  document.title = channel ? `${server.name} · #${channel.name} | TeamConnect` : server ? `${server.name} | TeamConnect` : "TeamConnect";
}
function openCreate(mode, serverId = activeServer()?.id) {
  if (!isAdmin() || storageBlocked || (mode === "channel" && !serverFor(state, serverId))) return;
  dialogMode = mode;
  createServerId = serverId;
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
let infoServerId = null;
function openServerInfo(serverId) {
  infoServerId = serverId;
  if (!renderServerInfo()) return;
  $("#server-members").open = false;
  serverInfoDialog.showModal();
}
serverInfoOption.addEventListener("click", () => {
  const id = menuServerId;
  closeContextMenu(true);
  openServerInfo(id);
});
managementOption.addEventListener("click", () => {
  const serverId = menuServerId;
  if (!isAdmin() || menuChannelId !== null || !serverFor(state, serverId)) return;
  closeContextMenu(true);
  openAdminSection(0, serverId);
});
const addMemberDialog = $("#add-member-dialog");
let memberTargetId = null;
function openAddMember(serverId) {
  const server = serverFor(state, serverId);
  if (!isAdmin() || !server || storageBlocked) return;
  memberTargetId = server.id;
  $("#add-member-title").textContent = "Add member to " + server.name;
  $("#member-email").value = "";
  $("#add-member-error").textContent = "";
  addMemberDialog.showModal();
}
$("#cancel-add-member").addEventListener("click", () => addMemberDialog.close());
$("#add-member-form").addEventListener("submit", event => {
  event.preventDefault();
  if (!isAdmin() || !addMemberDialog.open) return;
  const email = $("#member-email").value.trim().toLowerCase();
  const id = Object.keys(demoUsers).find(id => demoUsers[id].email.toLowerCase() === email);
  const error = $("#add-member-error");
  if (!id) {
    error.textContent = "No account has that sign-in email.";
    return;
  }
  let issue = "";
  const saved = updateState(latest => {
    const server = latest.servers.find(entry => entry.id === memberTargetId);
    if (!server) issue = "This server no longer exists.";
    else if (memberIds(server).includes(id)) issue = "This person already has access.";
    else {
      server.memberIds = [...memberIds(server), id];
      recordEvent(latest, server, "Membership", "Added " + demoUsers[id].email);
    }
  });
  if (!saved || issue) {
    error.textContent = issue || "Could not save the membership change. Try again.";
    return;
  }
  addMemberDialog.close();
  render();
  $("#admin-status").textContent = demoUsers[id].name + " added to the server.";
  $("#admin-title").focus();
});

function renderServerInfo() {
  const server = state.servers.find(entry => entry.id === infoServerId);
  if (!canAccess(server)) {
    if (serverInfoDialog.open) serverInfoDialog.close();
    return false;
  }
  const ids = memberIds(server);
  $("#server-member-count").textContent = ids.length + (ids.length === 1 ? " member" : " members");
  $("#server-member-list").replaceChildren(...ids.map(id => memberRow(id)));
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
  return true;
}
$("#close-server-info").addEventListener("click", () => serverInfoDialog.close());
editMessageOption.addEventListener("click", () => {
  const target = { serverId: menuServerId, channelId: menuChannelId, messageId: menuMessageId };
  const channel = messageChannel(state, target);
  const message = channel?.messages.find((entry) =>
    entry.id === target.messageId && entry.authorId === currentUser?.id && !entry.removedBy);
  if (!message || channel.archived) return;
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
  const error = changeMessage(editingMessage, (messages, index) => {
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
    const target = { serverId, channelId, messageId };
    const message = messageChannel(state, target)?.messages.find((entry) => entry.id === messageId);
    if (!currentUser || !message || (message.authorId !== currentUser.id && !isAdmin())) return;
    const moderation = message.authorId !== currentUser.id;
    if (!window.confirm(moderation
      ? "Remove this message as an admin? The channel will show a removal marker."
      : "Delete this message? This cannot be undone.")) return;
    const error = changeMessage(target, (messages, index) => {
      if (moderation) {
        messages[index].text = "";
        messages[index].removedBy = currentUser.id;
      } else messages.splice(index, 1);
      return true;
    }, moderation);
    if (error) $("#message-error").textContent = error;
    else refreshAfterMessageChange(moderation ? "Message removed by admin." : "Message deleted.");
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
  if (!isAdmin()) return;
  const isChannel = dialogMode === "channel";
  let name = $("#entity-name").value.trim();
  if (isChannel) name = name.toLowerCase().replace(/\s+/g, "-");
  if (!name || (isChannel && (name.length > 60 || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(name)))) {
    $("#dialog-error").textContent = isChannel ? "Enter a channel name using letters, numbers, and single hyphens." : "Enter a server name.";
    return;
  }
  const serverId = createServerId;
  let creationError = "";
  const saved = updateState((next) => {
    if (!isChannel) {
      const created = makeServer(name);
      recordEvent(next, created, "Servers", "Created server");
      next.servers.push(created); next.activeServerId = created.id;
    } else {
      const server = next.servers.find((s) => s.id === serverId);
      if (!server) { creationError = "This server no longer exists."; return; }
      if (server.channels.some((entry) => entry.name.toLowerCase() === name)) {
        creationError = "A channel with this name already exists.";
        return;
      }
      const channel = makeChannel(name);
      recordEvent(next, server, "Channels", "Created #" + name);
      server.channels.push(channel); server.activeChannelId = channel.id;
    }
  });
  if (creationError) { $("#dialog-error").textContent = creationError; return; }
  if (!saved) { $("#dialog-error").textContent = "Could not save. Check your browser storage and try again."; return; }
  const status = `${isChannel ? "Channel" : "Server"} ${name} created.`;
  dialog.close();
  if (isChannel && !$("#admin-page").hidden && adminSection === 0) {
    render();
    $("#admin-status").textContent = status;
    $("#admin-title").focus();
  } else {
    closeSettingsPages();
    render();
    closeSidebar();
    messageInput.focus();
    $("#message-status").textContent = status;
  }
});
messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!currentUser || !activeChannel() || activeChannel().archived) return;
  const text = messageInput.value.trim();
  if (!text || text.length > MAX_MESSAGE_LENGTH) {
    $("#message-error").textContent = "Enter a message of 1–2,000 characters.";
    messageInput.focus(); return;
  }
  const channelId = activeChannel().id;
  const serverId = activeServer()?.id;
  let sent = false;
  const saved = updateState((next) => {
    const channel = messageChannel(next, { serverId, channelId });
    if (!channel || channel.archived) return;
    channel.messages.push({ id: id(), authorId: currentUser.id, authorName: currentUser.name, text, createdAt: new Date().toISOString() });
    if (!isAdmin() && /(?:^|\s)@admin\b/i.test(text)) recordEvent(next, serverFor(next, serverId), "Mentions", "Mentioned @Admin in #" + channel.name);
    if (isAdmin()) channel.draft = "";
    else if (channel.drafts) delete channel.drafts[currentUser.id];
    sent = true;
  });
  if (saved && sent) {
    render(); $("#message-status").textContent = "Message sent."; messageInput.focus();
  } else if (saved) {
    render();
    $("#message-error").textContent = "This channel has been archived or removed.";
  }
});
messageInput.addEventListener("input", () => {
  if (!currentUser || !activeChannel() || activeChannel().archived) return;
  $("#message-error").textContent = ""; $("#message-status").textContent = "";
  const channelId = activeChannel().id;
  const serverId = activeServer()?.id;
  updateState((next) => {
    const channel = messageChannel(next, { serverId, channelId });
    if (!channel || channel.archived) return;
    if (isAdmin()) channel.draft = messageInput.value;
    else {
      channel.drafts ??= {};
      channel.drafts[currentUser.id] = messageInput.value;
    }
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
  if (event.key === PRESENCE_KEY || event.key?.startsWith(PRESENCE_KEY + ".")) {
    if (currentUser && event.key === scopedKey(PRESENCE_KEY, currentUser.id)) {
      presence = loadPresence();
      renderPresence();
    }
    refreshMemberStatuses(event.key);
  }
  if (event.key === null || (currentUser && event.key === scopedKey(APPEARANCE_KEY, currentUser.id))) {
    appearance = loadAppearance();
    renderAppearance();
  }
  if (event.key === STORAGE_KEY || event.key === null) {
    state = loadState();
    if (!storageBlocked) workspaceError("");
    render();
  }
});
initAdminSettings();
renderSession();

function updateMemberStatus(indicator, userId) {
  const status = loadPresence(userId);
  indicator.setAttribute("data-presence", status);
  indicator.textContent = presenceOptions[status].label;
}

function refreshMemberStatuses(storageKey) {
  for (const indicator of document.querySelectorAll("#admin-results [data-member-status]")) {
    const userId = indicator.getAttribute("data-member-status");
    if (storageKey === scopedKey(PRESENCE_KEY, userId)) updateMemberStatus(indicator, userId);
  }
}

function memberRow(id, server = null) {
  const member = loadUser(id);
  const row = node("li", "member-row");
  const identity = node("div");
  const details = [demoUsers[id].email];
  if (server && member.designation.trim()) details.push(member.designation.trim());
  details.push(member.role);
  const name = node("div", "member-name");
  name.append(node("strong", "", member.name));
  if (server) {
    const status = node("span", "member-status");
    status.setAttribute("data-member-status", id);
    updateMemberStatus(status, id);
    name.append(status);
  }
  identity.append(name, node("small", "", details.join(" · ")));
  row.append(identity);
  if (server && isAdmin() && id !== ADMIN_ID) {
    const remove = node("button", "button secondary member-remove", "Remove");
    remove.type = "button";
    remove.setAttribute("aria-label", "Remove " + member.name + " from " + server.name);
    remove.addEventListener("click", () => {
      if (!isAdmin() || !window.confirm("Remove " + member.name + " from " + server.name + "? They will lose access to its channels.")) return;
      const saved = updateState(latest => {
        const target = latest.servers.find(entry => entry.id === server.id);
        if (target && memberIds(target).includes(id)) {
          target.memberIds = memberIds(target).filter(memberId => memberId !== id);
          recordEvent(latest, target, "Membership", "Removed " + demoUsers[id].email);
        }
      });
      if (saved) {
        render();
        $("#admin-status").textContent = member.name + " removed from the server.";
        $("#admin-title").focus();
      } else $("#admin-status").textContent = "Could not save the membership change. Try again.";
    });
    row.append(remove);
  }
  return row;
}
