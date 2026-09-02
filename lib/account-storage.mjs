// Phạm vi localStorage của tài khoản đang đăng nhập. Module này không biết dữ
// liệu có hình dạng gì; nó chỉ bảo đảm cùng một trình duyệt không trộn dữ liệu
// của nhiều người và hỗ trợ chuyển kho một-người-dùng cũ cho đúng chủ sở hữu.
let accountId = "";

export function scopedStorageKey(base) {
  return accountId ? `${base}:user:${encodeURIComponent(accountId)}` : base;
}

function emptyStoredValue(raw) {
  if (raw === null || raw === "") return true;
  try {
    const value = JSON.parse(raw);
    if (value === null) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "object") {
      const values = Object.values(value);
      return values.length === 0 || values.every((item) =>
        (Array.isArray(item) && item.length === 0) ||
        (item && typeof item === "object" && Object.keys(item).length === 0),
      );
    }
  } catch {
    return false;
  }
  return false;
}

function itemKey(item) {
  if (!item || typeof item !== "object") return `value:${JSON.stringify(item)}`;
  if (item.id) return `id:${item.id}`;
  if (item.key) return `key:${item.key}`;
  if (item.videoId) return `video:${item.videoId}`;
  if (item.at) return `at:${item.at}:${item.term ?? item.taskId ?? item.wordId ?? ""}`;
  return `json:${JSON.stringify(item)}`;
}

function mergeValues(legacy, current) {
  if (Array.isArray(legacy) && Array.isArray(current)) {
    const merged = new Map();
    for (const item of legacy) merged.set(itemKey(item), item);
    for (const item of current) merged.set(itemKey(item), item);
    return [...merged.values()];
  }
  if (legacy && current && typeof legacy === "object" && typeof current === "object") {
    const merged = { ...legacy };
    for (const [key, value] of Object.entries(current)) {
      merged[key] = key in merged ? mergeValues(merged[key], value) : value;
    }
    return merged;
  }
  return current ?? legacy;
}

function mergeStoredValue(legacyRaw, currentRaw) {
  if (legacyRaw === null || emptyStoredValue(legacyRaw)) return currentRaw;
  if (currentRaw === null || emptyStoredValue(currentRaw)) return legacyRaw;
  try {
    return JSON.stringify(mergeValues(JSON.parse(legacyRaw), JSON.parse(currentRaw)));
  } catch {
    return currentRaw;
  }
}

export function setAccountStorageScope(userId, migrateLegacy = false, legacyKeys = []) {
  const next = String(userId ?? "").trim();
  const marker = next ? `lexilo:account-migrated:v2:user:${encodeURIComponent(next)}` : "";
  let migrationComplete = true;
  if (migrateLegacy && next && localStorage.getItem(marker) === null) {
    for (const base of legacyKeys) {
      try {
        const target = `${base}:user:${encodeURIComponent(next)}`;
        const merged = mergeStoredValue(localStorage.getItem(base), localStorage.getItem(target));
        if (merged !== null) localStorage.setItem(target, merged);
      } catch {
        // Kho cũ vẫn được giữ nguyên; lần tải sau có thể thử chuyển lại.
        migrationComplete = false;
      }
    }
    try {
      if (migrationComplete) localStorage.setItem(marker, new Date().toISOString());
    } catch {
      // Không ghi được dấu thì lần sau kiểm tra lại; dữ liệu không bị xoá.
    }
  }
  accountId = next;
}
