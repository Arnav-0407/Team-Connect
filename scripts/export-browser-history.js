// Run in the browser console on the original Team Connect page.
(() => {
  const workspaceKey = "teamconnect.workspace.v1";
  const legacyMessagesKey = "teamconnect.general.messages.v1";
  const keys = [workspaceKey, legacyMessagesKey];
  for (const account of ["user-arnav", "employee-arnav", "employee-parth"]) {
    const suffix = account === "user-arnav" ? "" : "." + account;
    for (const key of ["teamconnect.profile.v1", "teamconnect.appearance.v1", "teamconnect.presence"]) {
      keys.push(key + suffix);
    }
  }
  const data = Object.fromEntries(keys.flatMap(key => {
    const value = localStorage.getItem(key);
    return value === null ? [] : [[key, value]];
  }));
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "team-connect-history.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
})();
