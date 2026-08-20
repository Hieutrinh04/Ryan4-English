import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { DEFAULT_THEME, THEMES, applyTheme, normaliseTheme, readTheme, themeById, themeGroups, themeKey, writeTheme } =
  await import("../lib/themes.mjs");

test("mỗi giao diện có đủ mã, tên, độ sáng và góc màu", () => {
  for (const theme of THEMES) {
    assert.ok(theme.id && theme.label, `thiếu mã hoặc tên: ${JSON.stringify(theme)}`);
    assert.ok(theme.mode === "light" || theme.mode === "dark", `độ sáng lạ ở ${theme.id}`);
    assert.ok(Number.isFinite(theme.hue) && theme.hue >= 0 && theme.hue < 360, `góc màu lạ ở ${theme.id}`);
  }
  assert.equal(new Set(THEMES.map((theme) => theme.id)).size, THEMES.length, "có mã bị trùng");
});

test("mỗi tông màu đều có đủ một bản sáng và một bản tối", () => {
  for (const group of themeGroups()) {
    assert.equal(group.length, 2, `tông ${group[0].hue} không đủ cặp`);
    assert.deepEqual(group.map((theme) => theme.mode).sort(), ["dark", "light"]);
  }
});

test("bốn tông màu khác nhau, không có hai tông trùng góc", () => {
  const hues = themeGroups().map((group) => group[0].hue);
  assert.equal(hues.length, 4);
  assert.equal(new Set(hues).size, 4);
});

test("lựa chọn cũ light/dark được quy về giao diện tương ứng", () => {
  // Người đang dùng bản cũ không được nhảy về mặc định sau khi cập nhật.
  assert.equal(normaliseTheme("light"), "sang");
  assert.equal(normaliseTheme("dark"), "toi");
});

test("giá trị hỏng hoặc lạ thì về giao diện mặc định", () => {
  assert.equal(normaliseTheme("khong-co-that"), DEFAULT_THEME);
  assert.equal(normaliseTheme(""), DEFAULT_THEME);
  assert.equal(normaliseTheme(null), DEFAULT_THEME);
  assert.equal(normaliseTheme(undefined), DEFAULT_THEME);
});

test("themeById: mã lạ trả về mặc định chứ không phải undefined", () => {
  assert.equal(themeById("hong-toi").label, "Hồng Tối");
  assert.equal(themeById("linh tinh").id, DEFAULT_THEME);
});

test("đọc và ghi lựa chọn qua localStorage", () => {
  store.clear();
  assert.equal(readTheme(), DEFAULT_THEME);
  writeTheme("xanh-sang");
  assert.equal(store.get(themeKey), "xanh-sang");
  assert.equal(readTheme(), "xanh-sang");
});

test("ghi mã lạ thì lưu về mặc định, không lưu rác", () => {
  store.clear();
  writeTheme("khong-co-that");
  assert.equal(store.get(themeKey), DEFAULT_THEME);
});

test("applyTheme gắn cả độ sáng lẫn góc màu lên thẻ gốc", () => {
  const root = { dataset: {} };
  applyTheme("hong-sang", root);
  assert.equal(root.dataset.theme, "light");
  assert.equal(root.dataset.hue, "335");
  applyTheme("xanh-toi", root);
  assert.equal(root.dataset.theme, "dark");
  assert.equal(root.dataset.hue, "205");
});
