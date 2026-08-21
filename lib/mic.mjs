// Chọn thiết bị thu âm.
//
// Trình duyệt CHỈ trả về tên thiết bị sau khi người dùng đã cho phép dùng micro
// ít nhất một lần; trước đó label là chuỗi rỗng. Cho nên phải tự đặt tên "Micro 1,
// Micro 2" chứ không thể chờ có tên rồi mới hiện danh sách — chờ thì lần đầu vào
// bài người học thấy một ô rỗng.

export const micKey = "lexilo:mic:v1";

/** Chỉ giữ thiết bị thu âm, bỏ loa và camera. */
export function audioInputs(devices) {
  return (Array.isArray(devices) ? devices : []).filter(
    (device) => device?.kind === "audioinput" && typeof device.deviceId === "string",
  );
}

/**
 * Tên hiện cho một thiết bị. Chưa được cấp quyền thì đặt tên theo thứ tự.
 * Tên máy trả về thường rất dài ("Microphone (Realtek(R) Audio)") nên cắt bớt.
 */
export function micLabel(device, position = 0) {
  const raw = String(device?.label ?? "").trim();
  if (!raw) return `Micro ${position + 1}`;
  return raw.length > 44 ? `${raw.slice(0, 43)}…` : raw;
}

/** Danh sách sẵn sàng đổ vào ô chọn, kèm mục "mặc định của máy" đứng đầu. */
export function micOptions(devices) {
  return [
    { id: "", label: "Micro mặc định của máy" },
    ...audioInputs(devices).map((device, position) => ({ id: device.deviceId, label: micLabel(device, position) })),
  ];
}

/**
 * Thiết bị sẽ dùng. Micro đã lưu mà rút ra rồi thì quay về mặc định, thay vì
 * gọi getUserMedia với một deviceId không còn tồn tại và nhận lỗi khó hiểu.
 */
export function pickMic(devices, savedId) {
  const wanted = String(savedId ?? "").trim();
  if (!wanted) return "";
  return audioInputs(devices).some((device) => device.deviceId === wanted) ? wanted : "";
}

/** Ràng buộc truyền cho getUserMedia. Để trống thì trình duyệt tự chọn. */
export function audioConstraint(deviceId) {
  const id = String(deviceId ?? "").trim();
  return id ? { deviceId: { exact: id } } : true;
}

export function readMic() {
  try {
    return String(localStorage.getItem(micKey) ?? "");
  } catch {
    return "";
  }
}

export function saveMic(deviceId) {
  const id = String(deviceId ?? "").trim();
  try {
    if (id) localStorage.setItem(micKey, id);
    else localStorage.removeItem(micKey);
  } catch {
    // Chặn cookie/lưu trữ thì thôi, lần sau chọn lại.
  }
  return id;
}
