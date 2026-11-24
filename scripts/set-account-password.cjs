const { createInterface } = require("node:readline");
const { Writable } = require("node:stream");
const { accounts, openDatabase } = require("../server/database.cjs");

async function main() {
  const [id, email] = process.argv.slice(2);
  if (!accounts.some(account => account.id === id) || !process.stdin.isTTY) {
    throw new Error("In a terminal, run npm run account -- <user-arnav|employee-arnav|employee-parth> [sign-in-email]");
  }
  let muted = false;
  const output = new Writable({
    write(buffer, _encoding, done) {
      if (!muted) process.stdout.write(buffer);
      done();
    }
  });
  const input = createInterface({ input: process.stdin, output, terminal: true });
  const ask = prompt => new Promise(resolve => {
    process.stdout.write(prompt);
    muted = true;
    input.question("", answer => {
      muted = false;
      process.stdout.write("\n");
      resolve(answer);
    });
  });
  let password;
  try {
    password = await ask("New password (at least 12 characters): ");
    if (password !== await ask("Confirm password: ")) throw new Error("The passwords don't match.");
  } finally {
    input.close();
  }
  const db = openDatabase();
  try {
    await db.setPassword(id, password, email);
    console.log("Password saved for " + id + ".");
  } finally {
    db.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
