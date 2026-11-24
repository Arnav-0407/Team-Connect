async function createSupabaseWorkspace(config) {
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "js/supabase-sdk.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load the Supabase client."));
    document.head.append(script);
  });
  const client = globalThis.supabase.createClient(config.url, config.publishableKey);

  function result({ data, error, status }) {
    if (error) {
      if (!error.status && status) error.status = status;
      throw error;
    }
    return data;
  }

  return {
    getSession: async () => result(await client.auth.getSession()).session,
    onAuthChange(callback) {
      client.auth.onAuthStateChange((event, session) => {
        setTimeout(() => callback(event, session), 0);
      });
    },
    signIn: async (email, password) => result(await client.auth.signInWithPassword({ email, password })),
    signOut: async () => result(await client.auth.signOut({ scope: "local" })),
    async changePassword(email, oldPassword, newPassword) {
      await this.signIn(email, oldPassword);
      result(await client.auth.updateUser({ password: newPassword }));
    },
    snapshot: async () => result(await client.rpc("team_connect_snapshot")),
    async revision(authId) {
      const session = await this.getSession();
      if (session?.user?.id !== authId) throw Object.assign(new Error("The signed-in account changed."), { status: 401 });
      const data = result(await client.from("team_connect_sync").select("revision").eq("user_id", authId).maybeSingle());
      if (!data) throw Object.assign(new Error("Team Connect access is unavailable."), { status: 401 });
      return data.revision;
    },
    commit: async changes => result(await client.rpc("team_connect_commit", { changes })),
    subscribe(authId, refresh) {
      const stream = client.channel("team-connect:" + authId)
        .on("postgres_changes", {
          event: "UPDATE", schema: "public", table: "team_connect_sync", filter: "user_id=eq." + authId
        }, refresh)
        .subscribe(status => { if (status === "SUBSCRIBED") refresh(); });
      return () => { void client.removeChannel(stream); };
    }
  };
}
