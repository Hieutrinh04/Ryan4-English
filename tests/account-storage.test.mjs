import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { scopedStorageKey, setAccountStorageScope } = await import("../lib/account-storage.mjs");

test("chuyển kho cũ vào tài khoản chủ kể cả khi kho riêng đã lỡ được tạo rỗng", () => {
  store.clear();
  store.set("lexilo:words:v1", JSON.stringify([{ id: "old", term: "legacy" }]));
  store.set("lexilo:words:v1:user:owner", "[]");
  setAccountStorageScope("owner", true, ["lexilo:words:v1"]);
  assert.equal(scopedStorageKey("lexilo:words:v1"), "lexilo:words:v1:user:owner");
  assert.equal(JSON.parse(store.get("lexilo:words:v1:user:owner"))[0].term, "legacy");
});

test("hợp nhất kho cũ với kho riêng và giữ bản mới khi trùng", () => {
  store.clear();
  store.set("lexilo:reviews:v1", JSON.stringify([{ id: "same", value: "old" }, { id: "legacy-only" }]));
  store.set("lexilo:reviews:v1:user:owner", JSON.stringify([{ id: "same", value: "new" }]));
  setAccountStorageScope("owner", true, ["lexilo:reviews:v1"]);
  const merged = JSON.parse(store.get("lexilo:reviews:v1:user:owner"));
  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.id === "same").value, "new");
  assert.ok(merged.some((item) => item.id === "legacy-only"));
});

test("tài khoản thường không nhận dữ liệu cũ", () => {
  setAccountStorageScope("member", false, ["lexilo:words:v1"]);
  assert.equal(store.get("lexilo:words:v1:user:member"), undefined);
  setAccountStorageScope(null);
});
