// Nhật ký ôn tập theo thời gian và các chỉ số rút ra từ nó.
//
// Vì sao cần: mỗi thẻ từ chỉ giữ tổng số lượt ôn và tổng số lần quên, không có
// ngày tháng. Muốn trả lời "tuần này học được bao nhiêu từ mới, quên bao nhiêu từ
// cũ" thì phải ghi từng lượt kèm mốc thời gian. Nhật ký chỉ có dữ liệu KỂ TỪ khi
// tính năng này được bật — không dựng lại được quá khứ, và màn thống kê phải nói
// rõ điều đó thay vì hiện số 0 như thể bạn chưa học gì.

// Giữ tối đa ngần này lượt để localStorage không phình vô hạn. 20 nghìn lượt đủ
// cho vài năm học đều đặn.
export const MAX_ENTRIES = 20000;

export function localDay(date = new Date()) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 10);
}

// entry: { at (ISO), id, term, rating, boxBefore, boxAfter, firstTime }
export function appendEntry(entries, entry) {
  const next = [...entries, entry];
  return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
}

export function entriesSince(entries, days, now = new Date()) {
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  const fromDay = localDay(from);
  return entries.filter((entry) => typeof entry?.at === "string" && localDay(new Date(entry.at)) >= fromDay);
}

const GOOD = new Set(["good", "easy"]);

// Thống kê cho một quãng thời gian. Mọi con số đều đếm được từ nhật ký, không suy diễn.
export function summarise(entries) {
  const reviews = entries.length;
  const good = entries.filter((entry) => GOOD.has(entry.rating)).length;
  const forgot = entries.filter((entry) => entry.rating === "again");
  // "Từ mới học" = lần đầu tiên từ đó được ôn, tính theo cả lịch sử chứ không phải
  // lần đầu trong quãng đang xem — nếu không thì từ cũ ôn lại cũng bị tính là mới.
  const learned = new Set(entries.filter((entry) => entry.firstTime).map((entry) => entry.id));
  const forgotWords = new Set(forgot.map((entry) => entry.id));
  // Lên hộp 6 trong quãng này là mốc đáng ăn mừng.
  const mastered = new Set(entries.filter((entry) => entry.boxAfter === 6 && entry.boxBefore !== 6).map((entry) => entry.id));
  const days = new Set(entries.map((entry) => localDay(new Date(entry.at))));
  return {
    reviews,
    accuracy: reviews ? Math.round((good / reviews) * 100) : 0,
    learned: learned.size,
    forgot: forgot.length,
    forgotWords: forgotWords.size,
    mastered: mastered.size,
    activeDays: days.size,
    perDay: days.size ? Math.round((reviews / days.size) * 10) / 10 : 0,
  };
}

// Những từ quên nhiều nhất trong quãng — đây là chỗ cần luyện thêm.
export function weakest(entries, limit = 5) {
  const count = new Map();
  for (const entry of entries) {
    if (entry.rating !== "again") continue;
    const current = count.get(entry.id) ?? { id: entry.id, term: entry.term, times: 0 };
    current.times += 1;
    current.term = entry.term || current.term;
    count.set(entry.id, current);
  }
  return [...count.values()].sort((a, b) => b.times - a.times).slice(0, limit);
}

// Số lượt ôn theo từng ngày, dùng vẽ cột. Trả về mảng { day, reviews, forgot }.
export function byDay(entries, days, now = new Date()) {
  const buckets = [];
  for (let back = days - 1; back >= 0; back--) {
    const date = new Date(now);
    date.setDate(date.getDate() - back);
    buckets.push({ day: localDay(date), reviews: 0, forgot: 0 });
  }
  const index = new Map(buckets.map((bucket) => [bucket.day, bucket]));
  for (const entry of entries) {
    const bucket = index.get(localDay(new Date(entry.at)));
    if (!bucket) continue;
    bucket.reviews += 1;
    if (entry.rating === "again") bucket.forgot += 1;
  }
  return buckets;
}

// Gợi ý cải thiện, chỉ nói khi có đủ dữ liệu để chắc chắn. Thà im còn hơn khuyên bừa.
export function advice(summary, weakWords, streakCurrent) {
  const tips = [];
  if (summary.reviews < 20) {
    tips.push({ tone: "info", text: "Chưa đủ dữ liệu để nhận xét. Hãy ôn thêm vài phiên rồi quay lại xem." });
    return tips;
  }
  if (summary.accuracy < 60)
    tips.push({ tone: "warn", text: `Tỉ lệ nhớ ${summary.accuracy}% là thấp. Hãy giảm số từ mới mỗi ngày và ôn kỹ phần đang học trước khi nạp thêm.` });
  else if (summary.accuracy >= 85 && summary.learned < summary.reviews / 10)
    tips.push({ tone: "good", text: `Tỉ lệ nhớ ${summary.accuracy}% rất tốt mà số từ mới còn ít — bạn có thể tăng lượng từ mới mỗi ngày.` });
  if (summary.activeDays >= 3 && summary.perDay > 60)
    tips.push({ tone: "warn", text: `Trung bình ${summary.perDay} thẻ mỗi ngày học là khá nặng. Chia nhỏ thành hai phiên ngắn sẽ nhớ lâu hơn.` });
  if (weakWords.length)
    tips.push({ tone: "warn", text: `${weakWords.length} từ bị quên đi quên lại: ${weakWords.map((item) => item.term).join(", ")}. Hãy viết cho mỗi từ một câu của riêng bạn.` });
  if (streakCurrent >= 7) tips.push({ tone: "good", text: `Chuỗi ${streakCurrent} ngày liên tiếp — giữ nhịp này thì lịch ôn sẽ luôn đúng hạn.` });
  else if (summary.activeDays < 3) tips.push({ tone: "warn", text: "Học thưa quá thì lịch Leitner dồn lại. Học ngắn nhưng đều mỗi ngày hiệu quả hơn nhiều." });
  return tips;
}
