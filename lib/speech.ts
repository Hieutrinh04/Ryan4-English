// Nhận dạng giọng nói và đọc chữ, dùng chung cho mọi phần luyện nói.
//
// NHẮC LẠI GIỚI HẠN: trình duyệt chỉ cho biết máy NGHE RA chữ gì, không cho biết
// người học phát âm chuẩn hay chưa. Mọi con số dựng trên đây phải gọi là "độ rõ
// lời", không được gọi là "điểm phát âm".

export type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type Holder = { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };

let supportCache: boolean | undefined;

/** Trình duyệt có sẵn phần nhận dạng giọng nói hay không. Nhớ lại để khỏi dựng đi dựng lại. */
export function hasRecognition() {
  if (typeof window === "undefined") return false;
  if (supportCache === undefined) {
    const holder = window as unknown as Holder;
    supportCache = Boolean(holder.SpeechRecognition ?? holder.webkitSpeechRecognition);
  }
  return supportCache;
}

/** Một bộ nhận dạng mới, đã đặt sẵn tiếng Anh. Máy không hỗ trợ thì trả null. */
export function createRecogniser(): Recognition | null {
  if (typeof window === "undefined") return null;
  const holder = window as unknown as Holder;
  const Engine = holder.SpeechRecognition ?? holder.webkitSpeechRecognition;
  if (!Engine) return null;
  const engine = new Engine();
  engine.lang = "en-US";
  engine.continuous = false;
  engine.interimResults = false;
  engine.maxAlternatives = 1;
  return engine;
}

/** Câu báo bằng tiếng Việt cho từng loại trục trặc micro. */
export const MIC_ERRORS: Record<string, string> = {
  "not-allowed": "Trình duyệt chưa được cấp quyền dùng micro. Bấm biểu tượng khoá trên thanh địa chỉ để bật.",
  "service-not-allowed": "Trình duyệt chưa được cấp quyền dùng micro.",
  "no-speech": "Không nghe thấy tiếng nói. Nói to hơn hoặc lại gần micro rồi thử lại.",
  "audio-capture": "Không tìm thấy micro nào đang hoạt động.",
  network: "Mất kết nối tới dịch vụ nhận dạng giọng nói của trình duyệt.",
};

export function micError(code: string) {
  return MIC_ERRORS[code] ?? `Không thu được giọng nói (${code}).`;
}
