# Team Connect

Team Connect uses Supabase for sign-in, shared history, and live chat when `.env` contains a project URL and publishable key. The previous SQLite server remains available for importing old history or running locally. Use Node.js 24 or newer.

## Connect the Supabase project

1. Set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `.env`. The app uses the publishable key. Keep the database password and secret keys in Supabase.
2. In your Supabase project's **SQL Editor**, run `supabase/migrations/20261124000000_team_connect.sql` once. It creates the workspace schema, restricts API access, and enables Realtime for account revisions.
3. In **Authentication → Users**, create and confirm the three email/password users below. Use individual passwords. If you use different addresses, update the email addresses in `supabase/link-accounts.sql`. Run that file in the SQL Editor to link confirmed users. It reports the status of each account and can be run again as users are confirmed.

| Account | Default sign-in email |
| --- | --- |
| Admin | admin@gmail.com |
| Arnav Shaw | arnavshaw@gmail.com |
| Parth Singhal | parthsinghal@gmail.com |

From the Team Connect folder, run:

```sh
npm ci
npm start
```

If Team Connect was already running, restart it so it reads `.env`. Open http://127.0.0.1:8000 using two different browsers or browser profiles. Sign in as Admin in one, create a server and channel, and add an employee. Sign in as that employee in the other browser. Send and edit messages in both browsers, then refresh and verify that the history remains.

To serve the app to other devices, deploy the Node frontend behind HTTPS with the same two Supabase environment variables. The browsers connect to the shared Supabase project for chat and sign-in.

## Open with VS Code Live Server

Run `npm ci` once and `npm run prepare:live-server` after changing `.env` or the frontend files. This prepares the HTML, JavaScript, CSS, Supabase SDK, and publishable connection settings. The workspace setting points Live Server at `.data/live-server`, which contains only browser assets.

If Live Server is already open, stop it and start it again using **Go Live**. Open the address Live Server displays, usually http://127.0.0.1:5500/. Use the email and password for one of the linked Supabase accounts.

## Import existing chat history

Export old browser data before clearing site data. In DevTools at the original Team Connect URL and browser profile, run the contents of `scripts/export-browser-history.js`. Repeat for any other profiles with history you want to preserve.

After linking the three accounts, generate a SQL import. With no export argument, the tool reads the previous SQLite database. Set `TEAM_CONNECT_DB` if that database uses a different path.

```sh
node scripts/prepare-history-import.cjs --supabase > /tmp/team-connect-import.sql
node scripts/prepare-history-import.cjs --supabase ~/Downloads/team-connect-history.json > /tmp/team-connect-browser-import.sql
```

Pass multiple browser exports as additional arguments if needed. The tool stops when copies contain conflicting versions of the same record. Check intentional deletions before combining divergent exports. Run the generated SQL in Supabase's SQL Editor. It runs in one transaction and stops on conflicts with existing records. The export and generated SQL contain private chat data and exclude passwords. Keep them outside the repository.

## Run in SQLite mode

```sh
npm run account -- user-arnav
npm run account -- employee-arnav
npm run account -- employee-parth
TEAM_CONNECT_BACKEND=sqlite npm start
```

The account commands prompt for a password without displaying it. An optional email argument replaces the default sign-in address while preserving the account's history. SQLite uses `.data/team-connect.sqlite` by default. Use the same `TEAM_CONNECT_DB` path for the account commands, history import and server if you change it.

## Tests

Run `npm test` to check workspace behavior, server configuration, local live updates, and history import.
