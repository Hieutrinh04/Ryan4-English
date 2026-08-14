import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";
import fs from "node:fs/promises";

const files = [
  "01 Monday.xlsx", "02 Tuesday.xlsx", "03 Wednesday.xlsx", "04 Thursday.xlsx",
  "05 Friday.xlsx", "06 Saturday.xlsx", "07 Sunday.xlsx",
];
for (const file of files) {
  const path = `C:/Users/ADMIN/Downloads/${file}`;
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(path));
  const overview = await workbook.inspect({ kind: "sheet,table", maxChars: 5000, tableMaxRows: 12, tableMaxCols: 12, tableMaxCellChars: 100 });
  console.log(`\n### ${file}\n${overview.ndjson}`);
  const preview = await workbook.render({ sheetName: workbook.worksheets.getItemAt(0).name, autoCrop: "all", scale: 1, format: "png" });
  await fs.mkdir(".tmp/weekly-previews", { recursive: true });
  await fs.writeFile(`.tmp/weekly-previews/${file.replace(".xlsx", ".png")}`, new Uint8Array(await preview.arrayBuffer()));
}
