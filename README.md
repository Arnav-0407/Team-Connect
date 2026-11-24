# Team Connect

Team Connect uses one SQLite database for messages, servers, channels, memberships, and account settings. The Node server handles sign-in and sends live updates to connected browsers. Node.js 24 or newer is required. The project has no npm dependencies.

## Run locally

From the project folder, set an individual password for each existing account. The commands prompt for passwords without displaying them. An optional email argument replaces the listed sign-in address while preserving the account ID and its history.

```sh
npm run account -- user-arnav
npm run account -- employee-arnav
npm run account -- employee-parth
npm start
```

| Account | Default sign-in email |
| --- | --- |
| Admin | admin@gmail.com |
| Arnav Shaw | arnavshaw@gmail.com |
| Parth Singhal | parthsinghal@gmail.com |

Open http://127.0.0.1:8000 in two different browsers or browser profiles. Sign in as Admin in one, then create a server and channel and add an employee. Sign in as the employee in the other browser. Messages sent in either browser should appear in both without refreshing. Separate profiles let two different accounts stay signed in at once.

The default database is `.data/team-connect.sqlite`. To use a different persistent disk, set `TEAM_CONNECT_DB` to an absolute path and use the same path for account setup, import, and the server. A static copy of `index.html` runs the old demo. The shared workspace is available at the URL served by Node.

## Import existing browser history

Before clearing site data, open Team Connect in the original browser profile at its original URL. Run the contents of `scripts/export-browser-history.js` in that page's DevTools console. Repeat for other profiles with data you want to preserve. The downloads include private chat history and settings. Local password data is excluded.

```sh
npm run import-history -- ~/Downloads/team-connect-history.json
```

Pass additional exports as extra arguments. Identical records are deduplicated. The command reports conflicting versions and aborts the import if a record differs from one already in SQLite. Check for intentional deletions before combining divergent exports. An absent record can mean either that it was deleted or that it was never present in that browser. Import before adding new data to the shared workspace, then verify the migrated workspace from all three accounts.

## Use from other devices

Deploy one Node server with a persistent disk and an HTTPS reverse proxy. Use the same HTTPS URL in each browser. Set `TEAM_CONNECT_ORIGIN` to that public origin with no trailing slash and disable response buffering for `/api/live` in the proxy. Host and port default to `127.0.0.1:8000`. Set `HOST` and `PORT` if the proxy connects at a different address. Back up the SQLite database with a SQLite-aware backup or stop the server before copying it.

## Tests

Run `npm test` to cover the workspace UI, sign-in, message persistence, live updates, and access rules.
