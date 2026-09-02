// Kho bài nghe lấy từ video.
//
// Bài đi vào app qua phần neo của địa chỉ (#lesson=…) do tiện ích mở ra. Dữ liệu
// đến từ địa chỉ nên KHÔNG được tin: phải kiểm từng trường rồi mới lưu. Một bài
// hỏng lọt vào kho sẽ làm hỏng cả màn hình học, và người dùng không biết vì sao.
//
// App chỉ giữ mã video và phần lời. Video không được tải về và không được lưu.

export const lessonsKey = "lexilo:lessons:v1";
export const systemDraftsKey = "lexilo:system-lessons:v1";
export const MAX_LESSONS = 200;
export const MAX_SENTENCES = 2000;
import { CAPTION_VERSION, trimSilentTails } from "./caption-timing.mjs";
import { hasAwkwardBoundary, splitForPractice } from "./split-text.mjs";
import { cleanCaptionText } from "./youtube.mjs";
import { scopedStorageKey } from "./account-storage.mjs";

export const MAX_SHADOWING_WORDS = 30;

function text(value, limit) {
  return String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, limit);
}

function seconds(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : 0;
}

/**
 * Cắt một dòng phụ đề thành các mẩu vừa để luyện.
 *
 * Cắt theo ĐƠN VỊ NGHĨA chứ không theo số từ. Bản cũ cứ đủ 30 từ là chặt, nên
 * sinh ra đoạn kết thúc bằng "…they wouldn't feel safe in a" còn đoạn sau mở
 * đầu bằng "car without a human driver" — nhại một mẩu cụt như vậy thì không
 * biết ngữ điệu lên hay xuống, mà máy chấm cũng chệch theo.
 *
 * Mốc thời gian của từng mẩu chia theo tỉ lệ số từ. Đây là ước lượng, nhưng
 * phụ đề chỉ cho mốc của cả dòng nên không có cách nào chính xác hơn.
 */
function splitLongSentence(item) {
  const chunks = splitForPractice(item.text, MAX_SHADOWING_WORDS);
  if (chunks.length <= 1) return [item];

  const total = item.text.split(/\s+/).filter(Boolean).length || 1;
  const duration = Math.max(0, item.end - item.start);
  let used = 0;
  return chunks.map((chunk) => {
    const count = chunk.split(/\s+/).filter(Boolean).length;
    const start = item.start + duration * (used / total);
    used += count;
    return { ...item, start: seconds(start), end: seconds(item.start + duration * (used / total)), text: chunk };
  });
}

/**
 * Nối lại những câu đã bị bản cũ cắt ngang.
 *
 * Bản cũ cứ đủ 30 từ là chặt, nên trong kho của người dùng còn nhiều bài mà một
 * câu nằm vắt qua hai mục: mục trước kết bằng "…in a car without a human", mục
 * sau mở đầu bằng "driver, but there are concerns". Cắt lại thôi không đủ vì
 * mỗi mục được xử lý riêng — phải nối về một câu trước đã.
 *
 * Chỉ nối khi mục trước KHÔNG kết thúc trọn vẹn VÀ mục sau mở đầu bằng chữ
 * thường. Hai điều kiện cùng lúc thì gần như chắc chắn đó là một câu bị xé, chứ
 * không phải hai câu thật đứng cạnh nhau.
 */
function repairCutSentences(items) {
  const out = [];
  for (const item of items) {
    const previous = out[out.length - 1];
    const joinable = previous && hasAwkwardBoundary(previous.text, item.text);
    if (joinable) out[out.length - 1] = { ...previous, end: item.end, text: `${previous.text} ${item.text}` };
    else out.push({ ...item });
  }
  return out;
}

function mergeShortSentences(items) {
  const merged = [];
  let current = null;
  let endings = 0;
  const flush = () => {
    if (current) merged.push(current);
    current = null;
    endings = 0;
  };
  for (const item of repairCutSentences(items).flatMap(splitLongSentence)) {
    const count = item.text.split(/\s+/).length;
    const currentCount = current ? current.text.split(/\s+/).length : 0;
    if (current && (endings >= 2 || currentCount + count > MAX_SHADOWING_WORDS)) flush();
    if (!current) current = { ...item };
    else current = { ...current, end: item.end, text: `${current.text} ${item.text}` };
    endings += (item.text.match(/[.!?]["')\]]?(?:\s|$)/g) ?? []).length;
    if (endings >= 2) flush();
  }
  flush();
  return merged;
}

/**
 * Kiểm và làm sạch một bài do tiện ích gửi sang.
 * Trả về null nếu thiếu thứ không thể thiếu: mã video hoặc câu nào để học.
 */
export function sanitiseLesson(input) {
  const videoId = text(input?.videoId, 20);
  if (!/^[\w-]{11}$/.test(videoId)) return null;

  const sentences = (Array.isArray(input?.sentences) ? input.sentences : [])
    .slice(0, MAX_SENTENCES)
    .map((item, position) => ({
      index: position + 1,
      start: seconds(item?.start),
      end: seconds(item?.end),
      // Làm sạch cả bài đã lưu từ trước. Nếu chỉ dọn lúc tiện ích lấy mới thì
      // các video hiện có vẫn còn >>, [music], [applause] trên giao diện.
      text: cleanCaptionText(text(item?.text, 400)),
    }))
    .filter((item) => item.text);
  // Cắt đuôi im lặng ngay lúc đọc, không chỉ lúc lấy phụ đề về: người dùng đã
  // có sẵn hàng chục bài lưu từ trước với mốc kết thúc bám theo độ dài HIỂN THỊ
  // của phụ đề. Không sửa ở đây thì họ phải lấy lại từng video.
  //
  // Trừ bài mốc giờ ước lượng: mốc của chúng chia đều theo độ dài chữ trên cả
  // video, tốc độ suy ra vốn đã dưới ngưỡng nói, cắt nữa là cụt mất tiếng thật.
  const version = Number(input?.captionVersion) || 1;
  // Bản hiện hành đã cắt đuôi ở cấp cue TRƯỚC KHI gom thành đoạn. Không được
  // trim lần hai ở cấp đoạn: lần hai không còn timestamp từng cue để đối chiếu
  // và có thể cắt mất từ cuối ngay sát ranh giới câu kế tiếp.
  // Bản 7 đã có timestamp từng từ và đã trim ở cấp cue. Bản 8 chỉ thay cách
  // phân đoạn nội dung, vì vậy tuyệt đối không trim lần hai khi tự nâng 7 → 8.
  const timed = input?.estimated || version >= 7 ? sentences : trimSilentTails(sentences);
  // Bài cắt bằng bản hiện hành thì KHÔNG gom lại lần nữa.
  //
  // sentencesFrom đã gom theo đúng maxWords/maxSentences và giữ mốc thật của
  // từng dòng phụ đề. Gom lại ở đây chỉ phá: repairCutSentences thấy một mẩu kết
  // bằng dấu phẩy thì tưởng câu bị xé nên nối vào mẩu sau, rồi splitLongSentence
  // cắt lại theo TỈ LỆ SỐ TỪ — sinh ra ranh giới không có thật trong phụ đề.
  // Đo được: một câu đúng ra dứt ở 34,16 bị đẩy thành 40,36.
  //
  // Bài bản cũ và bài dán tay thì vẫn cần gom: mốc của chúng vốn đã là ước lượng,
  // và chúng thật sự có câu bị xé giữa chừng.
  // Bản 8 đã có cách gom câu hiện hành; bản 9 chỉ sửa ranh giới thời gian của
  // transcript DOM. Không được gom lại bài bản 8 vì sẽ phá mốc từng câu.
  const grouped = (version >= 8 ? timed : mergeShortSentences(timed))
    .map((item, position) => ({ ...item, index: position + 1 }));
  if (!grouped.length) return null;

  return {
    id: `yt-${videoId}`,
    videoId,
    title: text(input?.title, 200) || "Video không tên",
    author: text(input?.author, 120),
    seconds: Math.round(seconds(input?.seconds)),
    // Ghi lại nguồn để sau này biết bài nào lấy tự động, bài nào dán tay.
    source: input?.source === "system" ? "system" : input?.source === "extension" ? "extension" : "paste",
    estimated: Boolean(input?.estimated),
    timingPrecision: ["second", "millisecond", "word"].includes(input?.timingPrecision) ? input.timingPrecision : undefined,
    // Bài lưu từ trước khi có dấu này thì coi như bản 1.
    // Bản 7 có thể tự vá nội dung thành cách gom của bản 8, nhưng vẫn chưa có
    // ranh giới DOM mới của bản 9 nên chỉ nâng tới 8 và tiếp tục nhắc lấy lại.
    captionVersion: version === 7 ? 8 : version,
    sentences: grouped,
    addedAt: new Date().toISOString(),
  };
}

/** Đọc phần neo địa chỉ do tiện ích mở ra. Hỏng thì trả null, không ném lỗi. */
export function lessonFromHash(hash, decode) {
  const match = String(hash ?? "").match(/[#&]lesson=([^&]+)/);
  if (!match) return null;
  try {
    const json = decode(decodeURIComponent(match[1]));
    return sanitiseLesson(JSON.parse(json));
  } catch {
    return null;
  }
}

export function readLessons() {
  try {
    const raw = localStorage.getItem(scopedStorageKey(lessonsKey));
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // Đồng thời nâng cấp các bài đã lưu từ trước, không buộc người dùng lấy lại video.
    // Dựng bằng vòng lặp thay vì .map().filter(Boolean): filter(Boolean) không thu
    // hẹp được kiểu, nên mọi nơi gọi hàm này lại phải tự loại null một lần nữa.
    const clean = [];
    for (const item of parsed) {
      const lesson = sanitiseLesson(item);
      if (lesson) clean.push(lesson);
    }
    return clean;
  } catch {
    return [];
  }
}

/**
 * Ghép kho mặc định đi cùng ứng dụng với kho cá nhân trên máy.
 *
 * Khi trùng video, chọn bản phụ đề tốt hơn thay vì mặc định lấy bản hệ thống.
 * Phiên bản mới hơn thắng; cùng phiên bản thì bản có nhiều câu luyện hơn thắng.
 * Nếu mọi thứ ngang nhau mới giữ bản hệ thống. Quy tắc này tránh trường hợp vừa
 * nhập đủ 108 câu nhưng màn học lại mở bản hệ thống cũ chỉ có 4 câu.
 */
export function mergeLessonSources(systemLessons, personalLessons) {
  const system = (Array.isArray(systemLessons) ? systemLessons : [])
    .map((item) => sanitiseLesson({ ...item, source: "system" }))
    .filter(Boolean);
  const personal = (Array.isArray(personalLessons) ? personalLessons : [])
    .map((item) => sanitiseLesson(item))
    .filter(Boolean);
  const merged = [...system];
  const positions = new Map(merged.map((item, index) => [item.id, index]));
  for (const lesson of personal) {
    const position = positions.get(lesson.id);
    if (position === undefined) {
      positions.set(lesson.id, merged.length);
      merged.push(lesson);
      continue;
    }
    const current = merged[position];
    const currentVersion = Number(current.captionVersion) || 1;
    const incomingVersion = Number(lesson.captionVersion) || 1;
    if (incomingVersion > currentVersion || (incomingVersion === currentVersion && lesson.sentences.length > current.sentences.length)) {
      merged[position] = lesson;
    }
  }
  return merged.slice(0, MAX_LESSONS);
}

/** Kho bài mặc định do quản trị viên đang biên soạn trên máy này. */
export function readSystemDrafts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(systemDraftsKey) ?? "[]");
    return mergeLessonSources(parsed, []);
  } catch {
    return [];
  }
}

/** Đưa một hoặc nhiều bài đã lấy phụ đề vào kho mặc định cục bộ. */
export function promoteSystemLessons(lessons) {
  const incoming = Array.isArray(lessons) ? lessons : [lessons];
  const next = mergeLessonSources(incoming, readSystemDrafts());
  try {
    localStorage.setItem(systemDraftsKey, JSON.stringify(next));
  } catch {
    // Trình duyệt chặn lưu thì giao diện hiện tại vẫn có thể dùng danh sách trả về.
  }
  return next;
}

/**
 * Lưu một bài. Cùng video thì THAY bài cũ chứ không thêm bản trùng — người học
 * lấy lại một video thường là vì muốn bản phụ đề tốt hơn.
 */
export function saveLesson(lesson) {
  const clean = sanitiseLesson(lesson);
  if (!clean) return readLessons();
  const rest = readLessons().filter((item) => item.id !== clean.id);
  const next = [clean, ...rest].slice(0, MAX_LESSONS);
  try {
    localStorage.setItem(scopedStorageKey(lessonsKey), JSON.stringify(next));
  } catch {
    // Trình duyệt chặn lưu thì vẫn học được bài này trong phiên hiện tại.
  }
  return next;
}

export function removeLesson(id) {
  const next = readLessons().filter((item) => item.id !== id);
  try {
    localStorage.setItem(scopedStorageKey(lessonsKey), JSON.stringify(next));
  } catch {
    // Bỏ qua.
  }
  return next;
}

/** Câu đang phát ở giây thứ `at`, để làm nổi câu đó trong danh sách. */
export function sentenceAt(sentences, at) {
  const list = sentences ?? [];
  for (let i = list.length - 1; i >= 0; i -= 1) if (at >= list[i].start) return list[i];
  return list[0] ?? null;
}

// ── Tiến độ từng câu ────────────────────────────────────────────────────────
// Tách khỏi bản thân bài học: bài có thể được lấy lại (bản phụ đề tốt hơn) mà
// tiến độ vẫn phải còn. Đếm riêng cho từng cách luyện vì chép chính tả xong một
// câu không có nghĩa là đã nói nhại được câu đó.
export const lessonProgressKey = "lexilo:lesson-progress:v1";

export function readLessonProgress() {
  try {
    const raw = localStorage.getItem(scopedStorageKey(lessonProgressKey));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Đánh dấu một câu đã làm xong. Trả về bảng tiến độ sau khi cập nhật. */
export function markSentence(lessonId, mode, index) {
  const store = readLessonProgress();
  const id = String(lessonId ?? "");
  const which = mode === "shadowing" ? "shadowing" : "dictation";
  const position = Number(index);
  if (!id || !Number.isInteger(position) || position < 1) return store;

  const forLesson = store[id] ?? {};
  const done = new Set(Array.isArray(forLesson[which]) ? forLesson[which] : []);
  done.add(position);
  const next = { ...store, [id]: { ...forLesson, [which]: [...done].sort((a, b) => a - b) } };
  try {
    localStorage.setItem(scopedStorageKey(lessonProgressKey), JSON.stringify(next));
  } catch {
    // Trình duyệt chặn lưu thì vẫn học được, chỉ mất tiến độ.
  }
  return next;
}

/** Những câu đã làm xong của một bài, theo cách luyện. */
export function doneSentences(store, lessonId, mode) {
  const which = mode === "shadowing" ? "shadowing" : "dictation";
  const list = store?.[String(lessonId ?? "")]?.[which];
  return Array.isArray(list) ? list : [];
}

export function clearLessonProgress(lessonId) {
  const store = readLessonProgress();
  delete store[String(lessonId ?? "")];
  try {
    localStorage.setItem(scopedStorageKey(lessonProgressKey), JSON.stringify(store));
  } catch {
    // Bỏ qua.
  }
  return store;
}

export const reportsKey = "lexilo:caption-reports:v1";

// Báo phụ đề sai.
//
// Phụ đề lấy từ YouTube hay lệch giờ hoặc chép sai chữ, nhất là bản máy tự sinh.
// Không có máy chủ để gửi báo cáo đi, nên báo ở đây nghĩa là ĐÁNH DẤU CHO CHÍNH
// MÁY BẠN: câu đó bị gạch khỏi phần đếm tiến độ và hiện rõ là đang có vấn đề,
// để không phải vật lộn với một câu mà bản chép vốn đã sai.

export function readReports() {
  try {
    const raw = JSON.parse(localStorage.getItem(scopedStorageKey(reportsKey)) ?? "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

/** Bật tắt cờ báo lỗi của một câu. Bấm lần nữa là gỡ báo. */
export function toggleReport(lessonId, index) {
  const id = String(lessonId ?? "");
  const position = Number(index);
  if (!id || !Number.isInteger(position) || position < 1) return readReports();

  const store = readReports();
  const current = new Set(Array.isArray(store[id]) ? store[id] : []);
  if (current.has(position)) current.delete(position);
  else current.add(position);

  const list = [...current].sort((a, b) => a - b);
  const next = { ...store };
  if (list.length) next[id] = list;
  else delete next[id];
  try {
    localStorage.setItem(scopedStorageKey(reportsKey), JSON.stringify(next));
  } catch {
    // Chặn lưu trữ thì thôi, phần đang hiện trên màn hình vẫn đúng.
  }
  return next;
}

export function reportedSentences(store, lessonId) {
  const list = store?.[String(lessonId ?? "")];
  return Array.isArray(list) ? list : [];
}

/**
 * Bài này có cần bắt lại phụ đề không?
 *
 * Mốc câu của bài cũ không sửa lại được: lúc lưu, mốc của từng dòng phụ đề đã bị
 * gộp thành mốc câu rồi. Chỉ còn cách bắt lại từ video. Bài mốc giờ ước lượng
 * thì không tính — nó vốn không có phụ đề thật để mà bám.
 */
export function needsRecapture(lesson) {
  if (!lesson || lesson.estimated) return false;
  return (Number(lesson.captionVersion) || 1) < CAPTION_VERSION;
}
