// tsc does not copy .sql files. Copy them next to the compiled migrate.js so
// `node dist/db/migrate.js` can find them.
const fs = require("fs");
const path = require("path");
const src = path.join(__dirname, "..", "src", "db");
const dest = path.join(__dirname, "..", "dist", "db");
fs.mkdirSync(dest, { recursive: true });
let n = 0;
for (const f of fs.readdirSync(src)) {
  if (f.endsWith(".sql")) {
    fs.copyFileSync(path.join(src, f), path.join(dest, f));
    n++;
  }
}
if (n === 0) {
  console.error("copy-sql: no .sql files found in " + src);
  process.exit(1);
}
console.log(`copy-sql: copied ${n} SQL files to dist/db`);
