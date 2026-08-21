import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { audioConstraint, audioInputs, micKey, micLabel, micOptions, pickMic, readMic, saveMic } = await import("../lib/mic.mjs");

const may = (id, label = "", kind = "audioinput") => ({ deviceId: id, label, kind });

test("audioInputs: bỏ loa và camera, chỉ giữ micro", () => {
  const list = audioInputs([may("a"), may("b", "", "audiooutput"), may("c", "", "videoinput"), may("d")]);
  assert.deepEqual(list.map((device) => device.deviceId), ["a", "d"]);
});

test("audioInputs: dữ liệu sai kiểu không làm sập", () => {
  assert.deepEqual(audioInputs(null), []);
  assert.deepEqual(audioInputs("abc"), []);
  assert.deepEqual(audioInputs([null, undefined, {}]), []);
});

test("micLabel: chưa được cấp quyền thì đặt tên theo thứ tự", () => {
  // Trình duyệt trả label rỗng cho tới khi người dùng cho phép dùng micro.
  assert.equal(micLabel(may("a", "")), "Micro 1");
  assert.equal(micLabel(may("a", "  "), 2), "Micro 3");
  assert.equal(micLabel(undefined, 0), "Micro 1");
});

test("micLabel: tên máy quá dài thì cắt bớt", () => {
  const dai = "Microphone Array (Intel Smart Sound Technology for Digital Microphones)";
  const nhan = micLabel(may("a", dai));
  assert.ok(nhan.length <= 44, `dài ${nhan.length}`);
  assert.ok(nhan.endsWith("…"));
  // Tên vừa phải thì để nguyên, không cắt oan.
  assert.equal(micLabel(may("a", "Microphone (Realtek Audio)")), "Microphone (Realtek Audio)");
});

test("micOptions: luôn có mục mặc định đứng đầu", () => {
  const options = micOptions([may("a", "Micro rời"), may("b")]);
  assert.equal(options[0].id, "");
  assert.deepEqual(options.map((option) => option.label), ["Micro mặc định của máy", "Micro rời", "Micro 2"]);
});

test("micOptions: chưa có thiết bị nào vẫn còn mục mặc định", () => {
  assert.deepEqual(micOptions([]), [{ id: "", label: "Micro mặc định của máy" }]);
});

test("pickMic: micro đã lưu mà rút ra rồi thì quay về mặc định", () => {
  // Gọi getUserMedia với deviceId không còn tồn tại sẽ báo lỗi khó hiểu.
  assert.equal(pickMic([may("a"), may("b")], "b"), "b");
  assert.equal(pickMic([may("a")], "b"), "");
  assert.equal(pickMic([], "b"), "");
  assert.equal(pickMic([may("a")], ""), "");
  assert.equal(pickMic([may("a")], null), "");
});

test("audioConstraint: có chọn thì ép đúng thiết bị, không chọn thì để trình duyệt tự lo", () => {
  assert.deepEqual(audioConstraint("abc"), { deviceId: { exact: "abc" } });
  assert.equal(audioConstraint(""), true);
  assert.equal(audioConstraint("   "), true);
  assert.equal(audioConstraint(undefined), true);
});

test("lưu và đọc lại micro đã chọn", () => {
  store.clear();
  assert.equal(readMic(), "");
  saveMic("abc");
  assert.equal(readMic(), "abc");
  // Chọn lại mặc định thì xoá hẳn, không lưu chuỗi rỗng.
  saveMic("");
  assert.equal(store.has(micKey), false);
  assert.equal(readMic(), "");
});
