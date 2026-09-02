import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { addLessonsToCatalogue, addToCatalogue, catalogueKey, countNew, readCatalogue, removeFromCatalogue, withLessonState } =
  await import("../lib/catalogue.mjs");

const video = (id, extra = {}) => ({ videoId: id.padEnd(11, "x").slice(0, 11), title: `Bài ${id}`, channel: "BBC", seconds: 300, ...extra });

test("thêm video vào danh mục rồi đọc lại", () => {
  store.clear();
  addToCatalogue([video("a"), video("b")]);
  assert.equal(readCatalogue().length, 2);
  assert.equal(readCatalogue()[0].title, "Bài a");
});

test("thêm lại playlist cũ không tạo bản trùng và KHÔNG xáo thứ tự", () => {
  store.clear();
  addToCatalogue([video("a"), video("b")]);
  addToCatalogue([video("b"), video("c")]);
  const list = readCatalogue();
  // Thêm lại cả playlist mà xáo thứ tự thì người học mất dấu chỗ đang học dở.
  assert.deepEqual(list.map((item) => item.title), ["Bài a", "Bài b", "Bài c"]);
});

test("bài đã lấy phụ đề được thêm vào danh mục và hiện đúng tên kênh", () => {
  store.clear();
  addLessonsToCatalogue([
    { videoId: "lxxxxxxxxxx", title: "Bài từ tiện ích", author: "Lillian Chiu", seconds: 679 },
  ]);
  assert.deepEqual(
    readCatalogue().map(({ videoId, title, channel, seconds }) => ({ videoId, title, channel, seconds })),
    [{ videoId: "lxxxxxxxxxx", title: "Bài từ tiện ích", channel: "Lillian Chiu", seconds: 679 }],
  );
});

test("đồng bộ lại cùng một bài không tạo thẻ trùng", () => {
  store.clear();
  const lesson = { videoId: "lxxxxxxxxxx", title: "Bài từ tiện ích", author: "Lillian Chiu", seconds: 679 };
  addLessonsToCatalogue([lesson]);
  addLessonsToCatalogue([lesson]);
  assert.equal(readCatalogue().length, 1);
});

test("video hỏng không lọt vào danh mục", () => {
  store.clear();
  addToCatalogue([{ videoId: "ngắn", title: "x" }, { videoId: "aaaaaaaaaaa", title: "Private video" }, null]);
  assert.deepEqual(readCatalogue(), []);
});

test("xoá được một video khỏi danh mục", () => {
  store.clear();
  addToCatalogue([video("a"), video("b")]);
  removeFromCatalogue("axxxxxxxxxx");
  assert.deepEqual(readCatalogue().map((item) => item.title), ["Bài b"]);
});

test("dữ liệu hỏng trong localStorage không làm sập phần đọc", () => {
  store.clear();
  store.set(catalogueKey, "{không phải JSON");
  assert.deepEqual(readCatalogue(), []);
  store.set(catalogueKey, JSON.stringify([{ videoId: "aaaaaaaaaaa" }, { title: "thiếu mã" }]));
  assert.deepEqual(readCatalogue(), []);
});

test("countNew: nói trước sẽ thêm bao nhiêu video mới", () => {
  const current = [video("a")];
  assert.equal(countNew([video("a"), video("b"), video("c")], current), 2);
  // Trùng ngay trong lô gửi vào cũng chỉ tính một lần.
  assert.equal(countNew([video("d"), video("d")], current), 1);
  assert.equal(countNew([], current), 0);
  assert.equal(countNew(null, null), 0);
});

test("withLessonState: đánh dấu video đã có phụ đề để mở học ngay", () => {
  const entries = [video("a"), video("b")];
  const lesson = bai("axxxxxxxxxx", 3);
  const marked = withLessonState(entries, [lesson], { [lesson.id]: { dictation: [1, 2] } }, "dictation");
  assert.equal(marked[0].ready, true);
  assert.equal(marked[0].lesson, lesson, "thẻ phải giữ bài thật để bấm vào mở màn học");
  assert.equal(marked[0].done, 2);
  assert.equal(marked[0].total, 3);
  assert.equal(marked[1].ready, false);
  assert.equal(marked[1].lesson, null);
  assert.deepEqual(withLessonState(null, null), []);
});

const { shelves, videoProgress } = await import("../lib/catalogue.mjs");

const bai = (videoId, count) => ({ id: `yt-${videoId}`, videoId, sentences: Array.from({ length: count }, (_, i) => ({ index: i + 1 })) });

test("videoProgress: đếm câu đã xong và làm tròn xuống", () => {
  const progress = { "yt-axxxxxxxxxx": { shadowing: [1, 2] } };
  assert.deepEqual(videoProgress(bai("axxxxxxxxxx", 3), progress), { done: 2, total: 3, percent: 66 });
  // Chưa có phụ đề thì không có gì để đếm.
  assert.deepEqual(videoProgress(null, progress), { done: 0, total: 0, percent: 0 });
});

test("videoProgress: đếm riêng theo cách luyện", () => {
  const progress = { "yt-axxxxxxxxxx": { shadowing: [1], dictation: [1, 2, 3] } };
  assert.equal(videoProgress(bai("axxxxxxxxxx", 3), progress, "shadowing").done, 1);
  assert.equal(videoProgress(bai("axxxxxxxxxx", 3), progress, "dictation").done, 3);
});

test("shelves: chia theo trạng thái học, không theo kênh", () => {
  const videos = [video("a"), video("b"), video("c"), video("d")];
  const lessons = [bai("axxxxxxxxxx", 4), bai("bxxxxxxxxxx", 4), bai("cxxxxxxxxxx", 4)];
  const progress = {
    "yt-axxxxxxxxxx": { shadowing: [1, 2] },
    "yt-cxxxxxxxxxx": { shadowing: [1, 2, 3, 4] },
  };
  const kệ = shelves(videos, lessons, progress);
  assert.deepEqual(kệ.doing.map((item) => item.videoId), ["axxxxxxxxxx"]);
  assert.deepEqual(kệ.fresh.map((item) => item.videoId), ["bxxxxxxxxxx"]);
  assert.deepEqual(kệ.finished.map((item) => item.videoId), ["cxxxxxxxxxx"]);
  // Chưa có phụ đề để riêng: bấm vào không học được mà mở YouTube.
  assert.deepEqual(kệ.noCaption.map((item) => item.videoId), ["dxxxxxxxxxx"]);
});

test("shelves: bài gần xong nhất lên đầu kệ đang học", () => {
  const videos = [video("a"), video("b")];
  const lessons = [bai("axxxxxxxxxx", 10), bai("bxxxxxxxxxx", 10)];
  const progress = { "yt-axxxxxxxxxx": { shadowing: [1] }, "yt-bxxxxxxxxxx": { shadowing: [1, 2, 3, 4, 5, 6, 7, 8] } };
  assert.deepEqual(shelves(videos, lessons, progress).doing.map((item) => item.percent), [80, 10]);
});

test("shelves: dữ liệu sai kiểu trả về bốn kệ rỗng", () => {
  const kệ = shelves(null, null, null);
  assert.deepEqual([kệ.doing, kệ.fresh, kệ.finished, kệ.noCaption], [[], [], [], []]);
});
