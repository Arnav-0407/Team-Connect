function cloudWorkspaceState(records, accountId, previous = {}) {
  const state = { version: 1, defaultsRemoved: true, servers: [], activeServerId: null, events: [], helpRequests: [] };
  const servers = new Map();
  const channels = new Map();
  const byDate = (field) => (first, second) =>
    (Date.parse(first[field]) || 0) - (Date.parse(second[field]) || 0) || first.id.localeCompare(second.id);

  for (const { kind, id, data } of records) {
    if (kind === "server") servers.set(id, { ...data, id, channels: [], activeChannelId: null });
    if (kind === "channel") channels.set(id, { ...data, id, messages: [], draft: "", drafts: {} });
    if (kind === "event") state.events.push({ ...data, id });
    if (kind === "help") state.helpRequests.push({ ...data, id });
  }
  for (const { kind, id, data } of records) {
    const channel = channels.get(data.channelId);
    if (kind === "message" && channel) {
      const { serverId, channelId, ...message } = data;
      channel.messages.push({ ...message, id });
    }
    if (kind === "draft" && channel && data.owner === accountId) {
      if (accountId === "user-arnav") channel.draft = data.text;
      else channel.drafts[accountId] = data.text;
    }
  }
  for (const channel of channels.values()) {
    channel.messages.sort(byDate("createdAt"));
    servers.get(channel.serverId)?.channels.push(channel);
  }
  state.servers = [...servers.values()].sort(byDate("createdAt"));
  for (const server of state.servers) {
    server.channels.sort(byDate("createdAt"));
    const selected = previous.servers?.find(entry => entry.id === server.id)?.activeChannelId;
    server.activeChannelId = server.channels.find(entry => entry.id === selected)?.id ?? server.channels[0]?.id ?? null;
  }
  state.activeServerId = servers.has(previous.activeServerId) ? previous.activeServerId : state.servers[0]?.id ?? null;
  state.events.sort(byDate("time"));
  state.helpRequests.sort(byDate("createdAt"));
  return state;
}

function cloudWorkspaceRecords(state, accountId, knownAccounts) {
  const records = [];
  const add = (kind, id, data) => records.push({ kind, id, data });
  for (const server of state.servers) {
    const { id: serverId, channels, activeChannelId, ...metadata } = server;
    add("server", serverId, { ...metadata, memberIds: server.memberIds ?? knownAccounts });
    for (const channel of channels) {
      const { id: channelId, messages, draft, drafts, ...properties } = channel;
      add("channel", channelId, { ...properties, serverId, archived: Boolean(channel.archived) });
      for (const { id, ...message } of messages) add("message", id, { ...message, serverId, channelId });
      const text = accountId === "user-arnav" ? draft : drafts?.[accountId];
      if (text) add("draft", accountId + ":" + channelId, { serverId, channelId, owner: accountId, text });
    }
  }
  for (const { id, ...data } of state.helpRequests ?? []) add("help", id, data);
  for (const { id, ...data } of state.events ?? []) add("event", id, data);
  return records;
}

function cloudRecordChanges(original, updated) {
  const key = ({ kind, id }) => kind + ":" + id;
  const before = new Map(original.map(record => [key(record), record]));
  const after = new Map(updated.map(record => [key(record), record]));
  const changes = [];
  for (const [recordKey, record] of after) {
    const previous = before.get(recordKey)?.data ?? null;
    if (JSON.stringify(previous) !== JSON.stringify(record.data)) {
      changes.push({ kind: record.kind, id: record.id, before: previous, after: record.data });
    }
  }
  for (const [recordKey, { kind, id, data }] of before) {
    if (after.has(recordKey) || kind === "event") continue;
    // Parent deletions cascade on the backend, including drafts owned by other accounts.
    if (data.serverId && !after.has("server:" + data.serverId)) continue;
    if (data.channelId && !after.has("channel:" + data.channelId)) continue;
    changes.push({ kind, id, before: data, after: null });
  }
  return changes;
}

function createCloudWorkspace() {
  const authEvents = typeof BroadcastChannel === "function" ? new BroadcastChannel("team-connect-auth") : null;

  async function request(path, body) {
    const response = await fetch("/api/" + path, body === undefined ? {} : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) {
      throw Object.assign(new Error(data.message), { status: response.status, code: data.code });
    }
    return data;
  }

  async function getSession() {
    return (await request("session")).session;
  }

  return {
    getSession,
    onAuthChange(callback) {
      authEvents?.addEventListener("message", async () => {
        try {
          const session = await getSession();
          callback(session ? "SIGNED_IN" : "SIGNED_OUT", session);
        } catch { /* The next revision or reconnect will recheck the session. */ }
      });
    },
    async signIn(email, password) {
      const result = await request("sign-in", { email, password });
      authEvents?.postMessage("session-changed");
      return result;
    },
    async signOut() {
      await request("sign-out", {});
      authEvents?.postMessage("session-changed");
    },
    changePassword: (_email, oldPassword, newPassword) => request("password", { oldPassword, newPassword }),
    snapshot: () => request("workspace"),
    async revision(accountId) {
      const { account, revision } = await request("revision");
      if (account !== accountId) throw Object.assign(new Error("The signed-in account changed."), { status: 401 });
      return revision;
    },
    commit: changes => request("changes", { changes }),
    subscribe(_accountId, refresh) {
      const stream = new EventSource("/api/live");
      stream.addEventListener("message", refresh);
      return () => stream.close();
    }
  };
}
