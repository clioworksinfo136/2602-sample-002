// Builds DeleteRequest batches (25 per file) from the ids in add-batch-*.json,
// so the revert removes exactly the items that were inserted.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TABLE = "Date-tzm4ujadmfcyxh2rvvbml5skde-NONE";
const here = dirname(fileURLToPath(import.meta.url));

const ids = [];
for (let i = 1; i <= 4; i++) {
  const batch = JSON.parse(readFileSync(join(here, `add-batch-${i}.json`), "utf8"))[TABLE];
  for (const req of batch) ids.push(req.PutRequest.Item.id.S);
}

const unique = Array.from(new Set(ids));
let file = 0;
for (let i = 0; i < unique.length; i += 25) {
  const requests = unique.slice(i, i + 25).map((id) => ({
    DeleteRequest: { Key: { id: { S: id } } },
  }));
  file += 1;
  writeFileSync(join(here, `revert-batch-${file}.json`), JSON.stringify({ [TABLE]: requests }));
}
console.log(`ids: ${unique.length} (unique of ${ids.length}) -> ${file} revert files`);
