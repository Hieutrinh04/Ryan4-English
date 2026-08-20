// Chép bộ xử lý phụ đề từ lib/youtube.mjs sang extension/youtube.js.
//
// Vì sao phải chép thay vì import thẳng: tiện ích Chrome là một gói riêng, không
// nạp được tệp nằm ngoài thư mục của nó. Nhưng nếu để hai bản mã tách rời thì
// sớm muộn app và tiện ích sẽ cắt câu khác nhau, và bài lấy từ tiện ích sẽ lệch
// với bài tạo trong app. Chép bằng lệnh, có kiểm tra, thì không lệch được.
//
// Chạy: npm run build:extension

import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "lib/youtube.mjs";
const TARGET = "extension/youtube.js";

// Chỉ những hàm tiện ích thật sự cần. Không chép cả tệp: phần chấm chính tả và
// căn giờ ước lượng là việc của app, tiện ích không dùng tới.
const WANTED = ["sliceJsonArray", "pickEnglishTrack", "cuesFromJson3", "sentencesFrom"];

const source = readFileSync(SOURCE, "utf8");

/** Cắt trọn một khai báo hàm, đếm ngoặc nhọn để không cắt giữa chừng. */
function takeFunction(text, name) {
  // Nhận cả hàm có export lẫn hàm nội bộ: sentencesFrom còn gọi tới hàm round
  // không xuất ra ngoài, thiếu nó thì bản chép không chạy.
  let start = text.indexOf(`export function ${name}(`);
  if (start < 0) start = text.indexOf(`\nfunction ${name}(`) + 1;
  if (start <= 0) throw new Error(`${SOURCE} không còn hàm ${name} — cập nhật lại danh sách trong build/sync-extension.mjs`);

  // Lùi lên để giữ khối chú thích ngay trên hàm.
  let from = start;
  const before = text.slice(0, start).trimEnd();
  const comment = before.lastIndexOf("/**");
  if (comment >= 0 && !before.slice(comment).includes("}")) from = comment;
  else {
    const line = before.lastIndexOf("\n//");
    if (line >= 0 && before.slice(line).split("\n").every((row) => row.trim() === "" || row.trim().startsWith("//"))) from = line + 1;
  }

  // Bỏ qua danh sách tham số trước khi đếm ngoặc thân hàm: sentencesFrom nhận
  // tham số dạng { maxWords = 30 } = {}, đếm từ đó thì ngoặc đóng ngay trong phần
  // tham số và hàm bị cắt cụt.
  let cursor = text.indexOf("(", start);
  let round = 0;
  for (; cursor < text.length; cursor += 1) {
    if (text[cursor] === "(") round += 1;
    else if (text[cursor] === ")") {
      round -= 1;
      if (round === 0) break;
    }
  }

  let depth = 0;
  let started = false;
  for (let i = cursor; i < text.length; i += 1) {
    if (text[i] === "{") {
      depth += 1;
      started = true;
    } else if (text[i] === "}") {
      depth -= 1;
      if (started && depth === 0) return text.slice(from, i + 1);
    }
  }
  throw new Error(`không cắt được hàm ${name}`);
}

const parts = WANTED.map((name) => takeFunction(source, name));
const body = parts.join("\n");

// Chỉ chép helper mà các hàm trên THẬT SỰ gọi tới. Chép cả cụm cố định thì mỗi
// lần bản gốc đổi cách viết là bản chép thừa một hằng số chết, và lint bắt lỗi.
const helpers = [];
const sentenceEnd = source.match(/^const SENTENCE_END = .+$/m);
if (sentenceEnd && body.includes("SENTENCE_END")) helpers.push(sentenceEnd[0]);
if (body.includes("round(")) helpers.push(takeFunction(source, "round"));

const output = `// TỆP NÀY ĐƯỢC SINH RA TỰ ĐỘNG — ĐỪNG SỬA TAY.
// Nguồn: ${SOURCE}. Sinh lại bằng: npm run build:extension
//
// Tiện ích Chrome không nạp được tệp ngoài thư mục của nó, nên phải chép sang.
// Chép bằng lệnh để app và tiện ích không bao giờ cắt câu khác nhau.

${helpers.join("\n\n")}

${parts.join("\n\n")}
`;

writeFileSync(TARGET, output);
console.log(`đã sinh ${TARGET} từ ${SOURCE} (${WANTED.length} hàm, ${helpers.length} helper)`);
