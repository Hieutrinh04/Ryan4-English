import test from "node:test";
import assert from "node:assert/strict";
import { arpabetToIpa, looksLikeArpabet, normalizeIpa } from "../lib/arpabet.mjs";

test("looksLikeArpabet: nhận ra chuỗi CMU, bỏ qua IPA thường", () => {
  assert.equal(looksLikeArpabet("M AA1 R K S"), true);
  assert.equal(looksLikeArpabet("/M AA1 R K S/"), true);
  assert.equal(looksLikeArpabet("K AH0 M P Y UW1 T ER0"), true);
  assert.equal(looksLikeArpabet("/mɑːks/"), false);
  assert.equal(looksLikeArpabet("/kəmˈpjuːtər/"), false);
  assert.equal(looksLikeArpabet(""), false);
});

test("arpabetToIpa: từ một âm tiết", () => {
  assert.equal(arpabetToIpa("M AA1 R K S"), "ˈmɑrks");
  assert.equal(arpabetToIpa("K AE1 T"), "ˈkæt");
});

test("arpabetToIpa: nhiều âm tiết, trọng âm chính đúng chỗ", () => {
  const ipa = arpabetToIpa("K AH0 M P Y UW1 T ER0");
  assert.ok(ipa.includes("ˈ"), "phải có dấu trọng âm chính");
  assert.ok(ipa.startsWith("kə"), `bắt đầu bằng "kə": ${ipa}`);
  assert.ok(/j?uː/.test(ipa), `có nguyên âm uː: ${ipa}`);
});

test("arpabetToIpa: chuỗi rác trả rỗng", () => {
  assert.equal(arpabetToIpa(""), "");
  assert.equal(arpabetToIpa("???"), "");
});

test("normalizeIpa: đổi ARPABET, giữ IPA thường, bỏ placeholder", () => {
  assert.equal(normalizeIpa("/M AA1 R K S/"), "/ˈmɑrks/");
  assert.equal(normalizeIpa("M AA1 R K S"), "/ˈmɑrks/");
  assert.equal(normalizeIpa("/mɑːks/"), "/mɑːks/");
  assert.equal(normalizeIpa("mɑːks"), "/mɑːks/");
  assert.equal(normalizeIpa("/…/"), "");
  assert.equal(normalizeIpa(""), "");
});
