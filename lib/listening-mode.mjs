export const LISTENING_MODES = [
  { value: "easy", label: "Dễ", hint: "Nghe lại không giới hạn", replayLimit: Infinity },
  { value: "normal", label: "Bình thường", hint: "Tối đa 3 lượt mỗi câu", replayLimit: 3 },
  { value: "exam", label: "Thi IELTS", hint: "Phát liên tục một lượt, không tua", replayLimit: 1 },
];

export function replayLimit(mode) {
  return LISTENING_MODES.find((item) => item.value === mode)?.replayLimit ?? 3;
}

export function canReplay(mode, used) {
  return used < replayLimit(mode);
}

export function listeningModeLabel(mode) {
  return LISTENING_MODES.find((item) => item.value === mode)?.label ?? "Bình thường";
}
