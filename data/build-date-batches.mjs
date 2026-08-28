// Parses data/daily-reports-2014-2015.tsv (tab-separated: Date / Weather+Temp /
// Supervisor / quoted multi-line Observation / Inspector) and emits DynamoDB
// batch-write-item files for the Amplify "Date" table.
//
// Field mapping into the Date model:
//   2014/12/02      -> date: "2014-12-02"            (a.date(), ISO format)
//   "84 / Rain"     -> hight: 84, weather: "Rain"    (number before slash = high temp,
//   "84 /sunny"                                        text after slash = weather)
//   "84"            -> hight: 84, weather omitted
//   Supervisor      -> supervisor
//   quoted text     -> observation (newlines preserved)
//   Inspector       -> inspector
// Amplify system fields added per item: id (uuid), createdAt, updatedAt, __typename.
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TABLE = "Date-tzm4ujadmfcyxh2rvvbml5skde-NONE";
const here = dirname(fileURLToPath(import.meta.url));

const raw = readFileSync(join(here, "daily-reports-2014-2015.tsv"), "utf8")
  .replace(/\r\n?/g, "\n");

// A record starts at a line beginning with YYYY/MM/DD followed by a tab.
const lines = raw.split("\n");
const records = [];
for (const line of lines) {
  if (/^\d{4}\/\d{2}\/\d{2}\t/.test(line)) records.push([line]);
  else if (records.length && line.trim() !== "") records[records.length - 1].push(line);
  else if (records.length) records[records.length - 1].push("");
}
// The header line ("Date\tWeather/...") never matches the record regex above,
// so it's already excluded — no shift needed.

const recordRe = /^(\d{4}\/\d{2}\/\d{2})\t([^\t]*)\t([^\t]*)\t"([\s\S]*)"\t([^\t]*)$/;

function parseWeather(cell) {
  const text = cell.trim();
  const slash = text.indexOf("/");
  if (slash === -1) return { hight: Number(text) };
  const temp = Number(text.slice(0, slash).trim());
  const weather = text.slice(slash + 1).trim();
  return {
    ...(Number.isFinite(temp) && text.slice(0, slash).trim() !== "" ? { hight: temp } : {}),
    ...(weather !== "" ? { weather } : {}),
  };
}

const isoDate = (d) => {
  const [y, m, day] = d.split("/");
  return `${y}-${m}-${day}`;
};

const now = new Date().toISOString();
const S = (v) => ({ S: v });
const N = (v) => ({ N: String(v) });

const items = records.map((chunk, i) => {
  const joined = chunk.join("\n").replace(/\n+$/, "");
  const m = recordRe.exec(joined);
  if (!m) throw new Error(`Record ${i + 1} did not match expected layout:\n${joined.slice(0, 200)}`);
  const [, date, weatherCell, supervisor, observation, inspector] = m;
  const { hight, weather } = parseWeather(weatherCell);
  const item = {
    id: S(randomUUID()),
    __typename: S("Date"),
    date: S(isoDate(date)),
    ...(weather !== undefined ? { weather: S(weather) } : {}),
    ...(hight !== undefined ? { hight: N(hight) } : {}),
    ...(supervisor.trim() ? { supervisor: S(supervisor.trim()) } : {}),
    ...(inspector.trim() ? { inspector: S(inspector.trim()) } : {}),
    observation: S(observation),
    createdAt: S(now),
    updatedAt: S(now),
  };
  return { PutRequest: { Item: item } };
});

// DynamoDB allows max 25 requests per batch-write-item call.
const batches = [];
for (let i = 0; i < items.length; i += 25) {
  const requests = items.slice(i, i + 25);
  batches.push({ [TABLE]: requests });
  writeFileSync(join(here, `add-batch-${batches.length}.json`), JSON.stringify({ [TABLE]: requests }));
}

const dates = items.map((r) => r.PutRequest.Item.date.S);
const dup = dates.filter((d, i) => dates.indexOf(d) !== i);
console.log(`parsed ${items.length} records -> ${batches.length} batch files`);
console.log(`date range: ${dates.slice().sort()[0]} .. ${dates.slice().sort().at(-1)}`);
console.log(`duplicate dates: ${dup.length ? dup.join(", ") : "none"}`);
const missingHigh = items.filter((r) => !r.PutRequest.Item.hight).length;
const missingWeather = items.filter((r) => !r.PutRequest.Item.weather).length;
console.log(`records without hight: ${missingHigh}, without weather: ${missingWeather}`);
