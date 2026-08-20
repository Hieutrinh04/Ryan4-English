// Luyện nói theo tình huống: người học đóng một vai, mô hình đóng vai còn lại.
//
// Khác Shadowing ở chỗ căn bản: Shadowing là NHẠI LẠI một câu có sẵn, ở đây là
// TỰ NGHĨ ra câu để đạt mục tiêu của tình huống. Vì vậy không có "câu đúng" để so,
// mà chấm theo việc đã làm xong mục tiêu nào.
//
// Kịch bản do dự án tự soạn, tình huống đời thường, không lấy từ giáo trình nào.

export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

/** Biểu tượng theo chủ đề, thay cho tranh minh hoạ. */
export const SCENARIOS = [
  {
    id: "greet-colleague",
    level: "A1",
    icon: "hand",
    title: "Chào một đồng nghiệp mới",
    titleEn: "Greeting a new colleague",
    setting:
      "Patricia is a new colleague. Today is her first day at the company, and you are showing her around the office.",
    partner: "Patricia, a friendly new colleague on her first day",
    you: "an employee who has worked here for two years",
    starter: "Hi! I'm Patricia. I just started today — nice to meet you.",
    goals: ["Chào và giới thiệu tên mình", "Hỏi cô ấy làm ở bộ phận nào", "Mời cô ấy đi uống cà phê hoặc ăn trưa"],
  },
  {
    id: "order-food",
    level: "A1",
    icon: "cup",
    title: "Gọi món ở nhà hàng",
    titleEn: "Ordering food at a restaurant",
    setting: "You are at a small restaurant at lunchtime and want to order a meal. The waiter, Tom, comes to your table.",
    partner: "Tom, a polite waiter",
    you: "a customer who is hungry and in a slight hurry",
    starter: "Good afternoon! Here's the menu. Can I get you something to drink first?",
    goals: ["Gọi một món chính", "Hỏi giá hoặc hỏi món đó có gì", "Xin tính tiền"],
  },
  {
    id: "ask-directions",
    level: "A1",
    icon: "compass",
    title: "Hỏi đường",
    titleEn: "Asking for directions",
    setting: "You are lost in a new city and need to find the train station. You stop a local person on the street.",
    partner: "a helpful local person who knows the area well",
    you: "a visitor who does not know the city",
    starter: "Excuse me — you look a bit lost. Do you need any help?",
    goals: ["Hỏi đường tới nhà ga", "Hỏi đi bộ mất bao lâu", "Cảm ơn người ta"],
  },
  {
    id: "hotel-checkin",
    level: "A2",
    icon: "home",
    title: "Nhận phòng khách sạn",
    titleEn: "Checking in at a hotel",
    setting: "You have arrived at a hotel and need to check in. David, the receptionist, greets you at the desk.",
    partner: "David, a receptionist at a mid-range hotel",
    you: "a guest with a booking for three nights",
    starter: "Good evening, welcome. Do you have a reservation with us?",
    goals: ["Nói tên và số đêm đã đặt", "Hỏi giờ ăn sáng", "Hỏi mật khẩu wifi"],
  },
  {
    id: "doctor-visit",
    level: "A2",
    icon: "heart",
    title: "Đi khám bệnh",
    titleEn: "Visiting a doctor",
    setting: "You are not feeling well and visit a doctor. Dr. Chen asks you about your symptoms.",
    partner: "Dr. Chen, a calm and thorough doctor",
    you: "a patient who has had a sore throat and headache for three days",
    starter: "Hello, please take a seat. What seems to be the problem today?",
    goals: ["Mô tả triệu chứng", "Nói bị bao lâu rồi", "Hỏi cách uống thuốc"],
  },
  {
    id: "job-interview",
    level: "B1",
    icon: "briefcase",
    title: "Phỏng vấn xin việc",
    titleEn: "A job interview",
    setting: "You are being interviewed for a junior position at a software company. Linh is the hiring manager.",
    partner: "Linh, a hiring manager who asks follow-up questions",
    you: "a candidate applying for a junior developer role",
    starter: "Thanks for coming in. To start, could you tell me a little about yourself?",
    goals: ["Giới thiệu bản thân trong 3–4 câu", "Kể một việc đã làm và kết quả", "Hỏi lại một câu về công ty"],
  },
  {
    id: "complain-order",
    level: "B1",
    icon: "flag",
    title: "Phàn nàn về đơn hàng",
    titleEn: "Complaining about an order",
    setting: "An item you ordered arrived four days late and one part was missing. You call the shop.",
    partner: "an apologetic customer service agent who needs details before helping",
    you: "a customer who is annoyed but polite",
    starter: "Customer service, this is Mai speaking. How can I help you today?",
    goals: ["Nói rõ vấn đề", "Nói mình muốn được giải quyết thế nào", "Hỏi khi nào xong"],
  },
  {
    id: "debate-remote",
    level: "B2",
    icon: "chart",
    title: "Tranh luận về làm việc từ xa",
    titleEn: "Discussing remote work",
    setting: "In a team meeting, your colleague argues that everyone should return to the office full time. You disagree.",
    partner: "a colleague who prefers working in the office and pushes back on your points",
    you: "someone who wants to keep working from home two days a week",
    starter: "Honestly, I think we all work better when we're in the office together. Don't you agree?",
    goals: ["Nêu ý kiến của mình", "Đưa một lý do cụ thể", "Thừa nhận một điểm của đối phương rồi phản biện"],
  },
];

/** Lọc kịch bản theo trình độ. Bỏ trống hoặc "all" thì lấy tất cả. */
export function filterScenarios(scenarios, level) {
  if (!level || level === "all") return scenarios ?? [];
  return (scenarios ?? []).filter((item) => item.level === level);
}

/**
 * Mục tiêu nào đã xong.
 * Mô hình trả về danh sách chỉ số mục tiêu; ở đây chỉ nhận chỉ số hợp lệ và bỏ
 * trùng, vì một mục tiêu đã xong thì không xong lại được lần nữa.
 */
export function mergeGoals(done, reported, total) {
  const next = new Set(Array.isArray(done) ? done : []);
  for (const value of Array.isArray(reported) ? reported : []) {
    const index = Number(value);
    if (Number.isInteger(index) && index >= 0 && index < total) next.add(index);
  }
  return [...next].sort((a, b) => a - b);
}

/** Đã xong hết mục tiêu chưa. */
export function isComplete(done, total) {
  return total > 0 && (done ?? []).length >= total;
}

export const sessionsKey = "lexilo:speaking:v1";
export const MAX_SESSIONS = 300;

/** Một buổi nói đã xong, làm sạch trước khi lưu. */
export function makeSession({ scenarioId, title, level, turns, goalsDone, goalsTotal, corrections }, now = new Date()) {
  return {
    at: now.toISOString(),
    scenarioId: String(scenarioId ?? ""),
    title: String(title ?? "").slice(0, 160),
    level: LEVELS.includes(level) ? level : "A1",
    turns: Math.max(0, Math.floor(Number(turns) || 0)),
    goalsDone: Math.max(0, Math.floor(Number(goalsDone) || 0)),
    goalsTotal: Math.max(0, Math.floor(Number(goalsTotal) || 0)),
    corrections: Math.max(0, Math.floor(Number(corrections) || 0)),
  };
}

export function readSessions() {
  try {
    const raw = localStorage.getItem(sessionsKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.at === "string") : [];
  } catch {
    return [];
  }
}

export function saveSession(session) {
  const next = [session, ...readSessions()].slice(0, MAX_SESSIONS);
  try {
    localStorage.setItem(sessionsKey, JSON.stringify(next));
  } catch {
    // Trình duyệt chặn lưu thì vẫn nói được, chỉ mất lịch sử.
  }
  return next;
}

/** Tổng hợp: đã nói mấy buổi, xong bao nhiêu phần mục tiêu, kịch bản nào đã làm. */
export function summarise(sessions) {
  const list = sessions ?? [];
  if (!list.length) return { count: 0, turns: 0, goalRate: 0, corrections: 0, done: [] };
  const goalsDone = list.reduce((sum, item) => sum + (Number(item.goalsDone) || 0), 0);
  const goalsTotal = list.reduce((sum, item) => sum + (Number(item.goalsTotal) || 0), 0);
  return {
    count: list.length,
    turns: list.reduce((sum, item) => sum + (Number(item.turns) || 0), 0),
    goalRate: goalsTotal ? Math.round((goalsDone / goalsTotal) * 100) : 0,
    corrections: list.reduce((sum, item) => sum + (Number(item.corrections) || 0), 0),
    done: [...new Set(list.map((item) => item.scenarioId).filter(Boolean))],
  };
}
