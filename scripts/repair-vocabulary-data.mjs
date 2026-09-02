// Dọn trực tiếp các trường IPA/nghĩa trong file nguồn. Tên từ được giữ nguyên ở
// đây để các khóa câu ví dụ cũ vẫn khớp; lớp vocabulary-quality sẽ tách loại từ
// khỏi tên trước khi hiển thị.
import { readFileSync, writeFileSync } from "node:fs";
import { cleanVocabularyIpa, cleanVocabularyMeaning, vocabularyQualityReport } from "../lib/vocabulary-quality.mjs";

const path = new URL("../public/vocabulary-1000.json", import.meta.url);
const words = JSON.parse(readFileSync(path, "utf8"));
const repaired = words.map((word) => ({
  ...word,
  ipa: cleanVocabularyIpa(word.ipa, word.term),
  meaning: cleanVocabularyMeaning(word.meaning, word.term),
}));
const report = vocabularyQualityReport(repaired);
if (report.malformed.length) {
  throw new Error(`Còn ${report.malformed.length} mục lỗi: ${report.malformed.map((word) => word.term).join(", ")}`);
}
writeFileSync(path, `${JSON.stringify(repaired, null, 2)}\n`, "utf8");
console.log(`Đã kiểm ${report.total} từ; ${report.valid}/${report.total} mục hợp lệ.`);
