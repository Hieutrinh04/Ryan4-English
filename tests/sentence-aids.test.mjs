import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { ipaCacheKey, lookupWords, missingWords, readIpaCache, readTranslationCache, saveIpa, saveTranslation, withIpa } =
  await import("../lib/sentence-aids.mjs");

test("lookupWords: bỏ dấu câu, hạ chữ thường, bỏ trùng", () => {
  assert.deepEqual(lookupWords("How often do you... How?"), ["how", "often", "do", "you"]);
});

test("lookupWords: giữ dấu nháy và gạch nối giữa từ", () => {
  assert.deepEqual(lookupWords("It's a well-known fact."), ["it's", "a", "well-known", "fact"]);
});

test("lookupWords: bỏ số và ký tự không phải chữ cái", () => {
  assert.deepEqual(lookupWords("I got 5 apples & 3 pears."), ["i", "got", "apples", "pears"]);
  assert.deepEqual(lookupWords(""), []);
  assert.deepEqual(lookupWords(null), []);
});

test("missingWords: chỉ trả về từ chưa có trong bộ nhớ", () => {
  const cache = { how: "/haʊ/", often: "" };
  // "often" tra không ra vẫn tính là ĐÃ tra — không hỏi lại mãi một từ vô vọng.
  assert.deepEqual(missingWords("How often do you?", cache), ["do", "you"]);
});

test("withIpa: giữ nguyên dấu câu và chữ hoa của câu gốc", () => {
  const rows = withIpa("How often, Buli?", { how: "/haʊ/", often: "/ˈɒfən/", buli: "" });
  assert.deepEqual(rows.map((r) => r.word), ["How", "often,", "Buli?"]);
  assert.equal(rows[0].ipa, "/haʊ/");
  assert.equal(rows[1].ipa, "/ˈɒfən/");
  // Từ chưa tra được vẫn phải có mặt, chỉ là không có phiên âm.
  assert.equal(rows[2].ipa, "");
});

test("withIpa: câu rỗng thì trả về mảng rỗng", () => {
  assert.deepEqual(withIpa("", {}), []);
  assert.deepEqual(withIpa(null, {}), []);
});

test("nhớ lại phiên âm, kể cả từ tra không ra", () => {
  store.clear();
  saveIpa({ How: "/haʊ/", often: "" });
  const cache = readIpaCache();
  assert.equal(cache.how, "/haʊ/");
  assert.equal(cache.often, "");
  assert.deepEqual(missingWords("How often?", cache), []);
});

test("bộ nhớ hỏng không làm sập phần đọc", () => {
  store.clear();
  store.set(ipaCacheKey, "[1,2,3]");
  assert.deepEqual(readIpaCache(), {});
  store.set(ipaCacheKey, JSON.stringify({ how: 123, ok: "/ok/" }));
  assert.deepEqual(readIpaCache(), { ok: "/ok/" });
});

test("nhớ bản dịch theo đúng câu gốc", () => {
  store.clear();
  saveTranslation("How are you?", "Bạn khoẻ không?");
  assert.equal(readTranslationCache()["How are you?"], "Bạn khoẻ không?");
});

test("không nhớ bản dịch rỗng", () => {
  store.clear();
  saveTranslation("How are you?", "");
  saveTranslation("", "Gì đó");
  assert.deepEqual(readTranslationCache(), {});
});
