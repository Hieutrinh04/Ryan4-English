import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

import { spellOut } from "../lib/number-words.mjs";
const { NO_IPA, ipaCacheKey, lookupWords, missingWords, readIpaCache, readTranslationCache, saveIpa, saveTranslation, withIpa, wordKey } =
  await import("../lib/sentence-aids.mjs");

test("lookupWords: bỏ dấu câu, hạ chữ thường, bỏ trùng", () => {
  assert.deepEqual(lookupWords("How often do you... How?"), ["how", "often", "do", "you"]);
});

test("lookupWords: giữ dấu nháy và gạch nối giữa từ", () => {
  assert.deepEqual(lookupWords("It's a well-known fact."), ["it's", "a", "well-known", "fact"]);
});

test("lookupWords: số được tra theo cách đọc, ký tự lạ thì bỏ", () => {
  // Trước đây số bị loại thẳng nên "6" trong "6 Minute English" không bao giờ có
  // phiên âm. Nay tra theo cách đọc nó ra chữ.
  assert.deepEqual(lookupWords("I got 5 apples & 3 pears."), ["i", "got", "five", "apples", "three", "pears"]);
  assert.deepEqual(lookupWords("6 Minute English"), ["six", "minute", "english"]);
  assert.deepEqual(lookupWords(""), []);
  assert.deepEqual(lookupWords(null), []);
});

test("withIpa: chữ có số lấy phiên âm của cách đọc, ghép lại thành một", () => {
  const cache = { six: "/sˈɪks/", twenty: "/twˈɛnti/", nineteen: "/nˌaɪntˈin/" };
  const rows = withIpa("6 and 2019", cache);
  assert.equal(rows[0].ipa, "/sˈɪks/");
  assert.equal(rows[2].ipa, "/twˈɛnti nˌaɪntˈin/");
});

test("withIpa: thiếu một phần của số thì để trống, không hiện nửa vời", () => {
  const rows = withIpa("2019", { twenty: "/twˈɛnti/" });
  assert.equal(rows[0].ipa, "");
});

test("missingWords: chỉ trả về từ chưa có trong bộ nhớ", () => {
  const cache = { how: "/haʊ/", often: "" };
  // Kết quả rỗng không được coi là đã tra xong: endpoint có thể đã được cải thiện.
  assert.deepEqual(missingWords("How often do you?", cache), ["often", "do", "you"]);
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

test("chỉ nhớ phiên âm có dữ liệu, kết quả rỗng phải được tra lại", () => {
  store.clear();
  saveIpa({ How: "/haʊ/", often: "" });
  const cache = readIpaCache();
  assert.equal(cache.how, "/haʊ/");
  assert.equal(cache.often, undefined);
  assert.deepEqual(missingWords("How often?", cache), ["often"]);
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

test("wordKey: dấu lược cong của phụ đề YouTube quy về dấu thẳng", () => {
  // Đây là lỗi làm hầu hết từ rút gọn mất phiên âm: gửi đi một đằng, tra một nẻo.
  assert.equal(wordKey("don\u2019t"), "don't");
  assert.equal(wordKey("Today\u2019s"), "today's");
  assert.equal(wordKey("we\u02BCll"), "we'll");
  assert.equal(wordKey("don't"), "don't");
});

test("wordKey: bỏ dấu câu bám ngoài, giữ gạch nối và dấu lược bên trong", () => {
  assert.equal(wordKey("films."), "films");
  assert.equal(wordKey("(BBC)"), "bbc");
  assert.equal(wordKey("\u201Cstop\u201D"), "stop");
  assert.equal(wordKey("well-known"), "well-known");
  assert.equal(wordKey("--"), "");
  assert.equal(wordKey(""), "");
  assert.equal(wordKey(null), "");
});

test("lookupWords và withIpa luôn dùng cùng một khoá", () => {
  // Bài kiểm thử thật sự của lỗi: mọi chữ mà giao diện sẽ hiện đều phải nằm
  // trong danh sách gửi đi tra, nếu không nó không bao giờ có phiên âm.
  const cauThu = [
    "Today\u2019s episode is all about films and television.",
    "It\u2019s a well-known fact \u2014 and, honestly, a bit odd.",
    "He said \u201Cdon\u2019t stop\u201D and left.",
    "The caf\u00e9 serves cr\u00e8me br\u00fbl\u00e9e; no?",
    "We met in 2019 (COVID-19 changed everything).",
  ];
  for (const cau of cauThu) {
    const guiDi = new Set(lookupWords(cau));
    const hienRa = withIpa(cau, {})
      // Chữ có số tra theo cách đọc, nên khoá của nó là các chữ số đọc ra —
      // kiểm riêng ở bài trên, ở đây chỉ xét chữ thường.
      .filter((row) => !/\d/.test(row.word))
      .map((row) => wordKey(row.word))
      .filter(Boolean);
    const lech = hienRa.filter((key) => !guiDi.has(key));
    assert.deepEqual(lech, [], `chữ không bao giờ tra được trong "${cau}": ${lech.join(", ")}`);
  }
  // Và chữ có số cũng phải tra được: mọi phần đọc ra đều nằm trong danh sách gửi đi.
  for (const cau of ["We met in 2019", "at 7:30 sharp", "6 Minute English"]) {
    const guiDi = new Set(lookupWords(cau));
    for (const token of cau.split(/\s+/).filter((item) => /\d/.test(item))) {
      for (const part of spellOut(token)) {
        assert.ok(guiDi.has(part), `"${part}" của "${token}" không được gửi đi tra`);
      }
    }
  }
});

test("lookupWords: gạch dài tách chữ ra chứ không dính lại", () => {
  assert.ok(lookupWords("films \u2014 and shows").includes("films"));
  assert.ok(lookupWords("films\u2014and").includes("films"));
  assert.ok(lookupWords("films\u2014and").includes("and"));
});

test("saveIpa: chữ tra không ra thì KHÔNG nhớ, để lần sau còn hỏi lại", () => {
  // Nguồn trực tuyến có lúc hỏng; nhớ một lần hỏng là mất phiên âm vĩnh viễn.
  const cache = saveIpa({ alpha: "/a/", beta: "", gamma: "   " });
  assert.equal(cache.alpha, "/a/");
  assert.equal("beta" in cache, false);
  assert.equal("gamma" in cache, false);
});

test("saveIpa: nhớ theo đúng khoá chuẩn hoá", () => {
  const cache = saveIpa({ "Don\u2019t": "/doʊnt/" });
  assert.equal(cache["don't"], "/doʊnt/");
  assert.equal(withIpa("Don\u2019t", cache)[0].ipa, "/doʊnt/");
});

test("wordKey: chữ toàn số không phải một từ", () => {
  assert.equal(wordKey("2019"), "");
  assert.equal(wordKey("19"), "");
  // Chữ có số ở sau vẫn là một từ.
  assert.equal(wordKey("covid-19"), "covid-19");
});

test("withIpa: đánh dấu token nào là chữ, token nào chỉ là dấu câu", () => {
  const rows = withIpa("films \u2014 and \u2026", { films: "/f/", and: "/a/" });
  assert.deepEqual(rows.map((row) => [row.word, row.isWord]), [
    ["films", true],
    ["\u2014", false],
    ["and", true],
    ["\u2026", false],
  ]);
});

test("saveIpa: nhớ chữ chắc chắn không có, để thôi hỏi lại và thôi treo dấu ba chấm", () => {
  store.clear();
  const cache = saveIpa({ hello: "/həlˈoʊ/" }, ["buli"]);
  assert.equal(cache.hello, "/həlˈoʊ/");
  assert.equal(cache.buli, NO_IPA);
  // Đã tra rồi thì không hỏi lại nữa.
  assert.deepEqual(missingWords("Hello, Buli.", cache), []);
  // Nhưng vẫn không có phiên âm để hiện.
  const rows = withIpa("Hello, Buli.", cache);
  assert.equal(rows[0].ipa, "/həlˈoʊ/");
  assert.equal(rows[1].ipa, "");
  assert.equal(rows[1].checked, true);
});

test("withIpa: chưa tra thì checked=false, để giao diện biết mà hiện 'đang tra'", () => {
  const rows = withIpa("Hello Buli", { hello: "/h/" });
  assert.equal(rows[0].checked, true);
  assert.equal(rows[1].checked, false);
});

test("saveIpa: dấu 'không có' không đè lên phiên âm đã tra được", () => {
  store.clear();
  saveIpa({ sian: "/sˌiˈɑn/" });
  const cache = saveIpa({}, ["sian"]);
  assert.equal(cache.sian, "/sˌiˈɑn/");
});

test("saveIpa: chữ tra hỏng vì mạng KHÔNG bị nhớ, lần sau còn hỏi lại", () => {
  store.clear();
  // Máy chủ không nhắc tới chữ tra hỏng: không nằm trong found lẫn missing.
  const cache = saveIpa({ hello: "/h/" }, []);
  assert.equal("buli" in cache, false);
  assert.deepEqual(missingWords("Hello Buli", cache), ["buli"]);
});
