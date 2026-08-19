// Bộ nhãn lỗi phải khớp đúng ràng buộc check trong supabase/schema.sql, nếu không
// thì mỗi lần ghi error_events sẽ bị cơ sở dữ liệu từ chối.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ERROR_HINTS, ERROR_LABELS, ERROR_TYPES, normaliseErrorType, taxonomyPrompt } from "../lib/error-taxonomy.mjs";

test("mọi nhãn đều có tên tiếng Việt và mô tả", () => {
  for (const type of ERROR_TYPES) {
    assert.ok(ERROR_LABELS[type], `thiếu nhãn tiếng Việt cho ${type}`);
    assert.ok(ERROR_HINTS[type], `thiếu mô tả cho ${type}`);
  }
  assert.equal(Object.keys(ERROR_LABELS).length, ERROR_TYPES.length);
});

test("danh sách nhãn khớp với ràng buộc trong lược đồ", async () => {
  const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  const block = schema.slice(schema.indexOf("error_type text not null check"));
  const inSchema = [...block.slice(0, block.indexOf("))")).matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  assert.deepEqual([...inSchema].sort(), [...ERROR_TYPES].sort());
});

test("normaliseErrorType: nhãn hợp lệ giữ nguyên", () => {
  for (const type of ERROR_TYPES) assert.equal(normaliseErrorType(type), type);
});

test("normaliseErrorType: quy các biến thể hay gặp về nhãn chuẩn", () => {
  assert.equal(normaliseErrorType("Articles"), "article");
  assert.equal(normaliseErrorType("word order"), "word_order");
  assert.equal(normaliseErrorType("subject-verb agreement"), "agreement");
  assert.equal(normaliseErrorType("tense"), "verb_tense");
  assert.equal(normaliseErrorType("typo"), "spelling");
  assert.equal(normaliseErrorType("word choice"), "vocabulary");
});

test("normaliseErrorType: nhãn lạ rơi về other thay vì làm hỏng lượt ghi", () => {
  assert.equal(normaliseErrorType("chưa hay lắm"), "other");
  assert.equal(normaliseErrorType(""), "other");
  assert.equal(normaliseErrorType(undefined), "other");
  assert.equal(normaliseErrorType(null), "other");
});

test("taxonomyPrompt: liệt kê đủ nhãn để mô hình chọn đúng", () => {
  const prompt = taxonomyPrompt();
  for (const type of ERROR_TYPES) assert.ok(prompt.includes(type), `prompt thiếu ${type}`);
});
