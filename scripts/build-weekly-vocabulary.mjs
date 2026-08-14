import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const files = [
  "01 Monday.xlsx", "02 Tuesday.xlsx", "03 Wednesday.xlsx", "04 Thursday.xlsx",
  "05 Friday.xlsx", "06 Saturday.xlsx", "07 Sunday.xlsx",
];
const output = [];
const seen = new Set();
const skipped = [];

function parseCell(raw, studyDay, source) {
  if (typeof raw !== "string" || !raw.includes(":")) return;
  const [left, ...right] = raw.split(":");
  const meaning = right.join(":").trim();
  if (!meaning || left.trim().toUpperCase() === "CHỦ ĐỀ") return;
  const partMatches = [...left.matchAll(/\(([^)]+)\)/g)];
  const partOfSpeech = partMatches.map((match) => match[1].trim()).join(" / ");
  const term = left.replace(/\s*\([^)]+\)\s*/g, " ").replace(/\s+/g, " ").trim();
  if (!term) return;
  const key = term.toLowerCase();
  if (seen.has(key)) {
    skipped.push({ term, reason: "duplicate", source });
    return;
  }
  seen.add(key);
  output.push({
    id: `weekly-${studyDay}-${String(output.length + 1).padStart(3, "0")}`,
    term,
    meaning,
    partOfSpeech,
    studyDay,
    topic: "Từ vựng chung",
    source,
  });
}

for (let studyDay = 0; studyDay < files.length; studyDay++) {
  const file = files[studyDay];
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(`C:/Users/ADMIN/Downloads/${file}`));
  const sheet = workbook.worksheets.getItemAt(0);
  const values = sheet.getUsedRange(true).values;
  for (const row of values) for (const cell of row) parseCell(cell, studyDay, file);
}

await fs.writeFile("public/weekly-vocabulary.json", JSON.stringify(output, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ imported: output.length, byDay: files.map((file, day) => ({ file, count: output.filter((item) => item.studyDay === day).length })), skipped }, null, 2));
