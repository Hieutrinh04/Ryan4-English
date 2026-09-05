import assert from "node:assert/strict";
import test from "node:test";
import { canReplay, replayLimit } from "../lib/listening-mode.mjs";

test("chế độ dễ không giới hạn lượt nghe", () => {
  assert.equal(replayLimit("easy"), Infinity);
  assert.equal(canReplay("easy", 999), true);
});

test("bình thường tối đa ba lượt và thi chỉ một lượt", () => {
  assert.equal(canReplay("normal", 2), true);
  assert.equal(canReplay("normal", 3), false);
  assert.equal(canReplay("exam", 0), true);
  assert.equal(canReplay("exam", 1), false);
});
