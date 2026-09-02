// Danh sách từ do người dùng tự tạo — có tiêu đề, ghi chú, ngày tạo, và lồng
// được danh sách con bên trong, giống cách S English tổ chức phần "Danh sách từ".
//
// VÌ SAO LƯU RIÊNG, KHÔNG GẮN VÀO TỪ: writeLocalWords chỉ ghi xuống máy những từ
// CÁ NHÂN — nó lọc bỏ từ của bộ PDF và bộ mẫu vì hai bộ đó nạp lại được từ tệp
// json. Gắn danh sách thành một trường của WordCard thì 983 từ PDF sẽ mất danh
// sách sau mỗi lần tải lại trang. Nên đi theo đúng cách app đang lưu tiến độ
// Leitner: một kho riêng đánh theo mã từ, dùng được cho mọi từ bất kể nguồn nào.
//
// Một từ nằm được trong nhiều danh sách cùng lúc — "rescue" vừa thuộc "Từ cần ôn
// gấp" vừa thuộc "Chuẩn bị thi", và ép chọn một cái là bắt người học phải chọn
// giữa hai cách nghĩ đều đúng.

/**
 * @typedef {{ id: string, name: string, note: string, parentId: string, createdAt: string }} Folder
 * @typedef {{ list: Folder[], members: Record<string, string[]> }} FolderStore
 */

export const foldersKey = "lexilo:folders:v1";
let activeFoldersKey = foldersKey;

export const MAX_FOLDERS = 50;
const MAX_NAME = 60;
const MAX_NOTE = 300;
// Chặn lồng quá sâu: đường dẫn dài hơn thế thì thanh điều hướng không đọc nổi.
export const MAX_DEPTH = 3;

function cleanName(value) {
  return String(value ?? "").normalize("NFC").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
}

function cleanNote(value) {
  return String(value ?? "").normalize("NFC").trim().slice(0, MAX_NOTE);
}

/** Kho rỗng đúng hình dạng, để mọi nơi khỏi phải tự kiểm null. @returns {FolderStore} */
export function emptyStore() {
  return { list: [], members: {} };
}

/** Làm sạch dữ liệu đọc từ máy: hỏng cỡ nào cũng phải ra một kho dùng được. @param {unknown} raw @returns {FolderStore} */
export function normaliseStore(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyStore();
  const source = /** @type {{list?: unknown, members?: unknown}} */ (raw);
  let list = (Array.isArray(source.list) ? source.list : [])
    .map((item) => ({
      id: String(item?.id ?? ""),
      name: cleanName(item?.name),
      note: cleanNote(item?.note),
      parentId: String(item?.parentId ?? ""),
      createdAt: String(item?.createdAt ?? ""),
    }))
    .filter((item) => item.id && item.name)
    .slice(0, MAX_FOLDERS);

  // Danh sách cha đã biến mất thì cho con lên gốc, đừng để nó trôi mất khỏi giao diện.
  const ids = new Set(list.map((item) => item.id));
  list = list.map((item) => (item.parentId && ids.has(item.parentId) && item.parentId !== item.id ? item : { ...item, parentId: "" }));

  const members = /** @type {Record<string, string[]>} */ ({});
  for (const [folderId, wordIds] of Object.entries(source.members ?? {})) {
    // Bỏ thành viên của danh sách đã xoá, nếu không kho phình mãi.
    if (!ids.has(folderId) || !Array.isArray(wordIds)) continue;
    members[folderId] = [...new Set(wordIds.map((id) => String(id ?? "")).filter(Boolean))];
  }
  return { list, members };
}

/** @returns {FolderStore} */
export function readFolders() {
  try {
    return normaliseStore(JSON.parse(localStorage.getItem(activeFoldersKey) ?? "null"));
  } catch {
    return emptyStore();
  }
}

function write(store) {
  try {
    localStorage.setItem(activeFoldersKey, JSON.stringify(store));
  } catch {
    // Hết chỗ lưu thì thôi; phần đang hiện trên màn hình vẫn đúng.
  }
  return store;
}

/** Độ sâu của một danh sách, gốc là 0. @param {FolderStore} store @param {string} id @returns {number} */
export function depthOf(store, id) {
  const base = normaliseStore(store);
  const byId = new Map(base.list.map((item) => [item.id, item]));
  let depth = 0;
  let current = byId.get(id);
  while (current?.parentId && depth < MAX_DEPTH + 2) {
    depth += 1;
    current = byId.get(current.parentId);
  }
  return depth;
}

/**
 * Thêm một danh sách. Trùng tên TRONG CÙNG MỘT CHA thì trả về kho cũ và KHÔNG
 * tạo thêm — hai danh sách cùng tên nằm cạnh nhau thì người dùng không phân biệt
 * được cái nào chứa gì. Khác cha thì cho trùng, vì đường dẫn đã tách chúng ra.
 * @param {FolderStore} store @param {string} name
 * @param {{note?: string, parentId?: string}} [extra] @returns {FolderStore}
 */
export function addFolder(store, name, extra = {}) {
  const clean = cleanName(name);
  const base = normaliseStore(store);
  if (!clean || base.list.length >= MAX_FOLDERS) return base;
  const parentId = base.list.some((item) => item.id === extra.parentId) ? String(extra.parentId) : "";
  if (parentId && depthOf(base, parentId) + 1 >= MAX_DEPTH) return base;
  if (base.list.some((item) => item.parentId === parentId && item.name.toLowerCase() === clean.toLowerCase())) return base;
  const folder = {
    id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: clean,
    note: cleanNote(extra.note),
    parentId,
    createdAt: new Date().toISOString(),
  };
  return { ...base, list: [...base.list, folder] };
}

/**
 * Sửa tiêu đề và ghi chú. Tên rỗng thì không đổi gì; trùng tên với anh em cùng
 * cha cũng không đổi gì.
 * @param {FolderStore} store @param {string} id
 * @param {{name?: string, note?: string}} patch @returns {FolderStore}
 */
export function editFolder(store, id, patch = {}) {
  const base = normaliseStore(store);
  const current = base.list.find((item) => item.id === id);
  if (!current) return base;
  const name = patch.name === undefined ? current.name : cleanName(patch.name);
  if (!name) return base;
  if (base.list.some((item) => item.id !== id && item.parentId === current.parentId && item.name.toLowerCase() === name.toLowerCase())) return base;
  const note = patch.note === undefined ? current.note : cleanNote(patch.note);
  return { ...base, list: base.list.map((item) => (item.id === id ? { ...item, name, note } : item)) };
}

/** Mọi danh sách con cháu của một danh sách, không tính chính nó. @param {FolderStore} store @param {string} id @returns {string[]} */
export function descendantsOf(store, id) {
  const base = normaliseStore(store);
  const found = [];
  let frontier = [id];
  for (let step = 0; step < MAX_DEPTH + 1 && frontier.length; step += 1) {
    const next = base.list.filter((item) => frontier.includes(item.parentId)).map((item) => item.id);
    found.push(...next);
    frontier = next;
  }
  return found;
}

/**
 * Xoá danh sách cùng toàn bộ danh sách con và mọi liên kết của chúng.
 * Từ vựng thì KHÔNG đụng tới.
 * @param {FolderStore} store @param {string} id @returns {FolderStore}
 */
export function removeFolder(store, id) {
  const base = normaliseStore(store);
  const gone = new Set([id, ...descendantsOf(base, id)]);
  const members = { ...base.members };
  for (const key of gone) delete members[key];
  return { list: base.list.filter((item) => !gone.has(item.id)), members };
}

/** Bật tắt một từ trong danh sách. Cùng một nút cho cả hai chiều. @param {FolderStore} store @param {string} folderId @param {string} wordId @returns {FolderStore} */
export function toggleWord(store, folderId, wordId) {
  const base = normaliseStore(store);
  if (!base.list.some((item) => item.id === folderId) || !wordId) return base;
  const current = base.members[folderId] ?? [];
  const next = current.includes(wordId) ? current.filter((id) => id !== wordId) : [...current, wordId];
  return { ...base, members: { ...base.members, [folderId]: next } };
}

/** Thêm một loạt từ vào danh sách, bỏ qua từ đã có. @param {FolderStore} store @param {string} folderId @param {string[]} wordIds @returns {FolderStore} */
export function addWords(store, folderId, wordIds) {
  const base = normaliseStore(store);
  if (!base.list.some((item) => item.id === folderId)) return base;
  const current = new Set(base.members[folderId] ?? []);
  for (const id of Array.isArray(wordIds) ? wordIds : []) if (id) current.add(String(id));
  return { ...base, members: { ...base.members, [folderId]: [...current] } };
}

/** Bỏ một loạt từ khỏi danh sách. @param {FolderStore} store @param {string} folderId @param {string[]} wordIds @returns {FolderStore} */
export function removeWords(store, folderId, wordIds) {
  const base = normaliseStore(store);
  if (!base.list.some((item) => item.id === folderId)) return base;
  const drop = new Set((Array.isArray(wordIds) ? wordIds : []).map(String));
  return { ...base, members: { ...base.members, [folderId]: (base.members[folderId] ?? []).filter((id) => !drop.has(id)) } };
}

/** Các danh sách chứa một từ — để hiện dấu tích trong bảng chọn. @param {FolderStore} store @param {string} wordId @returns {string[]} */
export function foldersOf(store, wordId) {
  const base = normaliseStore(store);
  return base.list.filter((folder) => (base.members[folder.id] ?? []).includes(wordId)).map((folder) => folder.id);
}

/**
 * Từ vựng trong một danh sách, giữ đúng thứ tự của kho từ chứ không theo thứ tự thêm.
 * @template T
 * @param {FolderStore} store @param {string} folderId @param {T[]} words @returns {T[]}
 */
export function wordsIn(store, folderId, words) {
  const base = normaliseStore(store);
  const ids = new Set(base.members[folderId] ?? []);
  return (Array.isArray(words) ? words : []).filter((word) => ids.has(word?.id));
}

/**
 * Danh sách con trực tiếp của một danh sách, kèm số từ ĐANG CÓ THẬT và số danh
 * sách con. Truyền parentId rỗng để lấy các danh sách ở gốc.
 *
 * Đếm theo kho từ hiện tại chứ không theo độ dài danh sách thành viên: từ đã xoá
 * vẫn còn mã trong danh sách, đếm thẳng sẽ ra con số lớn hơn thực tế.
 *
 * @param {FolderStore} store @param {{id: string}[]} words @param {string} [parentId]
 * @returns {(Folder & {count: number, childCount: number})[]}
 */
export function foldersWithCounts(store, words, parentId = "") {
  const base = normaliseStore(store);
  const alive = new Set((Array.isArray(words) ? words : []).map((word) => word?.id));
  return base.list
    .filter((folder) => folder.parentId === parentId)
    .map((folder) => ({
      ...folder,
      count: (base.members[folder.id] ?? []).filter((id) => alive.has(id)).length,
      childCount: base.list.filter((item) => item.parentId === folder.id).length,
    }));
}

/** Đường dẫn từ gốc xuống một danh sách, để dựng thanh điều hướng. @param {FolderStore} store @param {string} id @returns {Folder[]} */
export function folderPath(store, id) {
  const base = normaliseStore(store);
  const byId = new Map(base.list.map((item) => [item.id, item]));
  const path = [];
  let current = byId.get(id);
  while (current && path.length <= MAX_DEPTH) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

const MONTHS_VI = "tháng 1,tháng 2,tháng 3,tháng 4,tháng 5,tháng 6,tháng 7,tháng 8,tháng 9,tháng 10,tháng 11,tháng 12".split(",");

/** Ngày tạo viết theo lối Việt: "15 tháng 8, 2026". @param {string} iso @returns {string} */
export function folderDate(iso) {
  const date = new Date(String(iso ?? ""));
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getDate()} ${MONTHS_VI[date.getMonth()]}, ${date.getFullYear()}`;
}

// ── Bọc lưu trữ ─────────────────────────────────────────────────────────────
/** @param {FolderStore} store @returns {FolderStore} */
export const saveFolders = (store) => write(normaliseStore(store));

// ── Nối vào React ───────────────────────────────────────────────────────────
// Đọc localStorage ngay lúc dựng thì máy chủ ra kho rỗng còn trình duyệt ra kho
// thật, và React báo lệch khi ghép cây. Đọc trong effect thì màn hình chớp một
// nhịp rỗng. useSyncExternalStore giải đúng cả hai: lượt ghép cây dùng ảnh chụp
// phía máy chủ, xong rồi mới đổi sang ảnh chụp thật.
//
// Ảnh chụp phải GIỮ NGUYÊN THAM CHIẾU giữa các lượt vẽ — React so bằng ===, trả
// về đối tượng mới mỗi lần gọi sẽ quay vòng vô tận.
let cache = null;
const listeners = new Set();
const SERVER_SNAPSHOT = emptyStore();

/** Khoá localStorage đang dùng, chủ yếu để kiểm thử việc tách tài khoản. */
export function folderStorageKey() {
  return activeFoldersKey;
}

/**
 * Tách danh sách tự tạo theo tài khoản trên cùng một trình duyệt. Với chủ kho cũ,
 * sao chép dữ liệu chưa phân vùng sang kho mới đúng một lần để không mất danh sách.
 */
export function setFolderScope(userId, migrateLegacy = false) {
  const clean = String(userId ?? "").trim();
  const nextKey = clean ? `${foldersKey}:user:${encodeURIComponent(clean)}` : foldersKey;
  if (nextKey === activeFoldersKey) return foldersSnapshot();
  try {
    const marker = clean ? `lexilo:folders-migrated:v2:user:${encodeURIComponent(clean)}` : "";
    if (migrateLegacy && clean && localStorage.getItem(marker) === null) {
      const legacy = readStoreAt(foldersKey);
      const current = readStoreAt(nextKey);
      const byId = new Map(legacy.list.map((folder) => [folder.id, folder]));
      for (const folder of current.list) byId.set(folder.id, folder);
      const members = { ...legacy.members };
      for (const [folderId, ids] of Object.entries(current.members)) {
        members[folderId] = [...new Set([...(members[folderId] ?? []), ...ids])];
      }
      localStorage.setItem(nextKey, JSON.stringify(normaliseStore({ list: [...byId.values()], members })));
    }
    if (migrateLegacy && clean && localStorage.getItem(marker) === null) localStorage.setItem(marker, new Date().toISOString());
  } catch {
    // Không có localStorage hoặc trình duyệt chặn lưu: vẫn đổi phạm vi trong bộ nhớ.
  }
  activeFoldersKey = nextKey;
  cache = readFolders();
  for (const fn of listeners) fn();
  return cache;
}

function readStoreAt(key) {
  try {
    return normaliseStore(JSON.parse(localStorage.getItem(key) ?? "null"));
  } catch {
    return emptyStore();
  }
}

export function subscribeFolders(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** @returns {FolderStore} */
export function foldersSnapshot() {
  if (!cache) cache = readFolders();
  return cache;
}

/** @returns {FolderStore} */
export function foldersServerSnapshot() {
  return SERVER_SNAPSHOT;
}

/** Lưu xuống máy rồi báo cho mọi nơi đang xem. @param {FolderStore} next @returns {FolderStore} */
export function commitFolders(next) {
  cache = saveFolders(next);
  for (const fn of listeners) fn();
  return cache;
}
