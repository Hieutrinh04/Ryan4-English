import assert from "node:assert/strict";
import test from "node:test";
import { inferLexicalType, lexicalTypeLabel } from "../lib/lexical-item.mjs";

test("phân loại mặc định một từ và cụm nhiều từ", () => {
  assert.equal(inferLexicalType("rescue"), "word");
  assert.equal(inferLexicalType("take for granted"), "chunk");
  assert.equal(inferLexicalType("make a decision", "collocation"), "collocation");
  assert.equal(inferLexicalType("How are you?"), "phrase");
});

test("nhãn loại lexical item thân thiện", () => {
  assert.equal(lexicalTypeLabel("collocation"), "Collocation");
  assert.equal(lexicalTypeLabel("unknown"), "Từ đơn");
});
