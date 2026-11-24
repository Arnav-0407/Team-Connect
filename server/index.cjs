const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const { resolve } = require("node:path");
const { openDatabase, AppError } = require("./database.cjs");

const root = resolve(__dirname, "..");
const cookieName = "team_connect_session";
const types = { html: "text/html", js: "text/javascript", css: "text/css" };

function sendJson(response, status, data, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(data));
}

async function jsonBody(request) {
  if (request.headers["content-type"]?.split(";")[0] !== "application/json") {
    throw new AppError(415, "Send JSON for this request.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new AppError(413, "This request is too large.");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks));
  } catch {
    throw new AppError(400, "Invalid JSON request.");
  }
}

function createTeamConnectServer({ filename, origin } = {}) {
  const db = openDatabase(filename);
  const secure = origin?.startsWith("https://");
  const streams = new Set();
  const attempts = new Map();

  function sessionCookie(token, maxAge = db.sessionLifetime / 1000) {
    return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  }

  function pushUpdates(accounts) {
    for (const stream of streams) {
      const account = db.session(stream.token);
      if (!account) stream.response.end();
      else if (accounts?.has(account.id)) stream.response.write(`data: ${account.revision}\n\n`);
    }
  }

  function throttleLogin(request, email) {
    const now = Date.now();
    for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
    for (const key of ["ip:" + request.socket.remoteAddress, "email:" + email]) {
      const entry = attempts.get(key) ?? { count: 0, until: now + 60_000 };
      entry.count += 1;
      attempts.set(key, entry);
      if (entry.count > (key.startsWith("ip:") ? 30 : 12)) {
        throw new AppError(429, "Too many sign-in attempts. Wait a minute and try again.");
      }
    }
  }

  async function api(request, response, pathname) {
    const token = request.headers.cookie?.match(new RegExp("(?:^|;\\s*)" + cookieName + "=([A-Za-z0-9_-]{43})(?:;|$)"))?.[1];
    const account = db.session(token);
    const session = user => ({ user: { id: user.id } });
    const signIn = request.method === "POST" && pathname === "/api/sign-in";
    if (request.method === "POST") {
      const requestOrigin = request.headers.origin;
      const expectedOrigin = origin || "http://" + request.headers.host;
      if ((requestOrigin && requestOrigin !== expectedOrigin) || request.headers["sec-fetch-site"] === "cross-site") {
        throw new AppError(403, "This request must come from Team Connect.");
      }
    }

    if (request.method === "GET" && pathname === "/api/session") {
      return sendJson(response, 200, { session: account ? session(account) : null });
    }
    if (signIn) {
      const fields = await jsonBody(request);
      if (!fields || typeof fields.email !== "string" || fields.email.length > 254 ||
          typeof fields.password !== "string" || fields.password.length > 1024) {
        throw new AppError(400, "Enter your email and password.");
      }
      const email = fields.email.trim().toLowerCase();
      throttleLogin(request, email);
      const match = await db.verifyPassword(email, fields.password);
      if (!match) throw new AppError(401, "The email or password is incorrect.", "invalid_credentials");
      attempts.delete("email:" + email);
      db.signOut(token);
      pushUpdates();
      const newToken = db.issueSession(match.id);
      return sendJson(response, 200, { session: session(match) }, { "Set-Cookie": sessionCookie(newToken) });
    }
    if (request.method === "POST" && pathname === "/api/sign-out") {
      await jsonBody(request);
      db.signOut(token);
      pushUpdates();
      return sendJson(response, 200, {}, { "Set-Cookie": sessionCookie("", 0) });
    }
    if (!account) throw new AppError(401, "Sign in to Team Connect.");
    if (request.method === "POST" && pathname === "/api/password") {
      const fields = await jsonBody(request);
      if (typeof fields?.oldPassword !== "string" || fields.oldPassword.length > 1024 ||
          typeof fields.newPassword !== "string" || fields.newPassword.length > 1024) {
        throw new AppError(400, "Enter your current and new passwords.");
      }
      throttleLogin(request, account.email);
      const verified = await db.verifyPassword(account.email, fields.oldPassword);
      if (!verified) throw new AppError(403, "The current password is incorrect.", "invalid_credentials");
      await db.setPassword(account.id, fields.newPassword, null, verified.password_hash);
      pushUpdates();
      const newToken = db.issueSession(account.id);
      return sendJson(response, 200, { session: session(account) }, { "Set-Cookie": sessionCookie(newToken) });
    }
    if (request.method === "GET" && pathname === "/api/workspace") {
      return sendJson(response, 200, db.snapshot(account));
    }
    if (request.method === "GET" && pathname === "/api/revision") {
      return sendJson(response, 200, { account: account.id, revision: account.revision });
    }
    if (request.method === "POST" && pathname === "/api/changes") {
      const fields = await jsonBody(request);
      const current = db.session(token);
      if (!current) throw new AppError(401, "Sign in to Team Connect.");
      const changed = db.commit(current, fields?.changes);
      pushUpdates(changed);
      return sendJson(response, 200, {});
    }
    if (request.method === "GET" && pathname === "/api/live") {
      if ([...streams].filter(stream => stream.token === token).length >= 8) {
        throw new AppError(429, "Too many live connections for this session.");
      }
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no"
      });
      response.write(`retry: 1000\ndata: ${account.revision}\n\n`);
      const stream = { token, response };
      streams.add(stream);
      response.on("close", () => streams.delete(stream));
      return;
    }
    throw new AppError(404, "Unknown Team Connect endpoint.");
  }

  const server = createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname.startsWith("/api/")) return await api(request, response, pathname);
      if (request.method !== "GET" && request.method !== "HEAD") {
        throw new AppError(405, "This page only supports GET and HEAD.");
      }
      if (pathname === "/js/backendConfig.js") {
        response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
        return response.end(request.method === "HEAD" ? undefined : 'globalThis.teamConnectConfig = { backend: "sqlite" };\n');
      }
      const asset = pathname === "/" ? "/index.html" : pathname;
      if (asset !== "/index.html" && !/^\/(?:js\/(?:[\w-]+\/)*[\w-]+\.js|css\/[\w-]+\.css)$/.test(asset)) {
        throw new AppError(404, "Page not found.");
      }
      const body = await readFile(root + asset);
      response.writeHead(200, { "Content-Type": types[asset.split(".").at(-1)] + "; charset=utf-8", "Cache-Control": "no-cache" });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      if (response.headersSent) return response.end();
      const status = error.status || (error.code === "ENOENT" ? 404 : 500);
      if (status === 500) console.error(error);
      sendJson(response, status, {
        message: status === 500 ? "Team Connect could not complete this request." : status === 404 ? "Page not found." : error.message,
        code: error instanceof AppError ? error.code : undefined
      });
    }
  });
  const heartbeat = setInterval(() => {
    for (const { token, response } of streams) {
      if (db.session(token)) response.write(": keepalive\n\n");
      else response.end();
    }
  }, 15000);
  heartbeat.unref();
  server.on("close", () => { clearInterval(heartbeat); db.close(); });
  server.closeLiveStreams = () => { for (const stream of streams) stream.response.end(); };
  return server;
}

if (require.main === module) {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || 8000);
  const origin = process.env.TEAM_CONNECT_ORIGIN;
  if (origin && new URL(origin).origin !== origin) throw new Error("TEAM_CONNECT_ORIGIN must be an origin without a trailing slash.");
  const server = createTeamConnectServer({ origin });
  server.listen(port, host, () => console.log("Team Connect listening at " + (origin || `http://${host}:${port}`)));
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => { server.closeLiveStreams(); server.close(); });
  }
}

module.exports = { createTeamConnectServer };
