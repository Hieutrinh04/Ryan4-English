// Giới hạn nhịp gọi cho các route AI.
//
// Vì sao cần: mỗi lượt chấm bài hay sinh đoạn văn đều tốn tiền ở nhà cung cấp mô
// hình. Route đang mở công khai, chỉ một vòng lặp trong console cũng đủ đốt hết
// hạn mức. Ở đây có hai lớp: cửa sổ trượt chặn gọi dồn dập, và hạn mức ngày chặn
// dùng quá nhiều trong cả ngày.
//
// Bộ đếm nằm trong bộ nhớ của isolate nên không tuyệt đối chính xác khi
// Cloudflare chạy nhiều isolate. Nó chặn được lạm dụng thô — thứ mà hôm nay
// đang hoàn toàn không có gì chặn. Hạn mức chính xác cần bộ đếm dùng chung, sẽ
// dựa vào bảng ai_usage khi đã bắt buộc đăng nhập.

/** Số lần gọi và mốc thời gian, giữ theo từng khoá người dùng. */
export function createLimiter({ windowMs = 60_000, burst = 6, dailyQuota = 60 } = {}) {
  const buckets = new Map();

  function dayOf(now) {
    return Math.floor(now / 86_400_000);
  }

  function prune(now) {
    // Không để bộ nhớ phình theo số khoá đã từng gặp.
    if (buckets.size < 5000) return;
    for (const [key, bucket] of buckets) {
      if (now - bucket.last > 86_400_000) buckets.delete(key);
    }
  }

  return {
    /** Kiểm tra và trừ một lượt nếu được phép. */
    take(key, now = Date.now()) {
      prune(now);
      const today = dayOf(now);
      const bucket = buckets.get(key) ?? { hits: [], day: today, used: 0, last: now };
      if (bucket.day !== today) {
        bucket.day = today;
        bucket.used = 0;
      }
      bucket.hits = bucket.hits.filter((at) => now - at < windowMs);
      bucket.last = now;
      buckets.set(key, bucket);

      if (bucket.used >= dailyQuota) {
        return { ok: false, reason: "quota", retryAfterSeconds: secondsToMidnight(now), remainingToday: 0 };
      }
      if (bucket.hits.length >= burst) {
        const oldest = bucket.hits[0];
        return {
          ok: false,
          reason: "burst",
          retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
          remainingToday: dailyQuota - bucket.used,
        };
      }

      bucket.hits.push(now);
      bucket.used += 1;
      return { ok: true, reason: "", retryAfterSeconds: 0, remainingToday: dailyQuota - bucket.used };
    },

    /** Trả lại một lượt khi lệnh gọi hỏng vì lỗi phía chúng ta, không phải lỗi người dùng. */
    refund(key, now = Date.now()) {
      const bucket = buckets.get(key);
      if (!bucket) return;
      if (bucket.day === dayOf(now) && bucket.used > 0) bucket.used -= 1;
      bucket.hits.pop();
    },

    get size() {
      return buckets.size;
    },
  };
}

function secondsToMidnight(now) {
  return Math.max(1, Math.ceil((86_400_000 - (now % 86_400_000)) / 1000));
}

/** Câu báo bằng tiếng Việt cho người học, không phải thông báo kỹ thuật. */
export function limitMessage(reason, retryAfterSeconds) {
  if (reason === "quota") return "Bạn đã dùng hết lượt AI của hôm nay. Mai quay lại nhé — phần luyện tập không cần AI vẫn dùng được bình thường.";
  return `Bạn đang gửi hơi nhanh. Chờ ${retryAfterSeconds} giây rồi thử lại.`;
}
