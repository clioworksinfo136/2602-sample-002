// ASCII-escape non-ASCII characters in the batch JSON files so the Windows
// AWS CLI file:// loader (codepage-decoded) cannot choke on UTF-8 content.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
for (const i of process.argv.slice(2)) {
  const p = join(here, `add-batch-${i}.json`);
  const escaped = readFileSync(p, "utf8").replace(
    /[\u0080-\uFFFF]/g,
    (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0")
  );
  writeFileSync(p, escaped);
  console.log(p, "ascii-safe:", !/[\u0080-\uFFFF]/.test(escaped));
}
