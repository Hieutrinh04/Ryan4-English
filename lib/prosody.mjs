// Chia câu thành các cụm nhịp nói và chọn trọng âm chính của từng cụm.
//
// Đây không phải bộ phân tích ngữ pháp đầy đủ. Mục tiêu là tránh kiểu chặt đều
// mỗi năm từ (dễ kết bằng "and", "the", "to") và đưa người học tới đúng nhịp
// tiếng Anh: mỗi cụm ngắn mang một ý, với một từ nội dung làm hạt nhân nhấn.

const WEAK = new Set([
  "a", "an", "the", "and", "or", "but", "so", "for", "nor", "yet",
  "of", "to", "in", "on", "at", "by", "from", "with", "as", "into", "onto", "over", "under", "about", "after", "before",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "my", "your", "his", "its", "our", "their",
  "this", "that", "these", "those", "who", "which", "what", "when", "where", "why", "how",
  "am", "is", "are", "was", "were", "be", "been", "being", "do", "does", "did", "have", "has", "had",
  "can", "could", "will", "would", "shall", "should", "may", "might", "must",
  "not", "no", "if", "because", "although", "though", "while", "than", "then", "there", "here",
]);

const LINKERS = new Set(["and", "but", "or", "so", "because", "although", "though", "while", "when", "if", "which", "who", "that"]);

function keyOf(token) {
  return String(token ?? "").toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");
}

function contentWord(token) {
  const key = keyOf(token);
  return Boolean(key) && !WEAK.has(key) && !/^(?:'s|'re|'ve|'d|'ll|n't)$/.test(key);
}

function punctuation(token) {
  if (/(?:\.{2,}|…)["')\]]?$/.test(token)) return "pause";
  if (/[.!?]["')\]]?$/.test(token)) return "sentence";
  if (/[,;:—–]["')\]]?$/.test(token)) return "clause";
  return "";
}

/**
 * @returns {{text:string, stress:string, words:{text:string, stressed:boolean}[]}[]}
 */
export function rhythmGroups(text, { minWords = 2, idealWords = 5, maxWords = 7 } = {}) {
  const words = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const limit = Math.max(3, Number(maxWords) || 7);
  const ideal = Math.min(limit, Math.max(2, Number(idealWords) || 5));
  const minimum = Math.min(ideal, Math.max(1, Number(minWords) || 2));
  const size = words.length;
  const costs = Array(size + 1).fill(Number.POSITIVE_INFINITY);
  const next = Array(size + 1).fill(size);
  costs[size] = 0;

  for (let from = size - 1; from >= 0; from -= 1) {
    for (let to = from + 1; to <= Math.min(size, from + limit); to += 1) {
      const length = to - from;
      const last = words[to - 1];
      const mark = punctuation(last);
      let cost = Math.abs(length - ideal) * 4;
      if (length < minimum && to < size) cost += 30;
      if (!mark && !contentWord(last)) cost += 55;
      if (mark === "sentence") cost -= 28;
      else if (mark === "clause") cost -= 22;
      else if (mark === "pause") cost -= 12;
      if (to < size && LINKERS.has(keyOf(words[to]))) cost -= 14;
      // Không nuốt qua một ranh giới mạnh nằm giữa cụm.
      for (let at = from; at < to - 1; at += 1) {
        const inside = punctuation(words[at]);
        if (inside === "sentence") cost += 90;
        else if (inside === "clause" || inside === "pause") cost += 35;
      }
      cost += costs[to];
      if (cost < costs[from]) {
        costs[from] = cost;
        next[from] = to;
      }
    }
  }

  const groups = [];
  for (let from = 0; from < size;) {
    const to = Math.max(from + 1, next[from]);
    const slice = words.slice(from, to);
    let stressAt = -1;
    for (let at = slice.length - 1; at >= 0; at -= 1) {
      if (contentWord(slice[at])) {
        stressAt = at;
        break;
      }
    }
    if (stressAt < 0) stressAt = slice.length - 1;
    groups.push({
      text: slice.join(" "),
      stress: slice[stressAt],
      words: slice.map((word, at) => ({ text: word, stressed: at === stressAt })),
    });
    from = to;
  }
  return groups;
}

// ── Chấm ngữ điệu khi nói nhại ───────────────────────────────────────────────
//
// GIỚI HẠN, PHẢI NÓI RÕ: đây KHÔNG so trực tiếp bản ghi của bạn với giọng mẫu
// (không lấy được tiếng từ video YouTube). Nó đo ba thứ trong CHÍNH bản ghi của
// bạn rồi đối chiếu với hình mẫu mong đợi của câu:
//   • Nhịp ngắt  — có dừng hơi ở ranh giới cụm không, hay đọc một mạch phẳng lì
//   • Nhấn nhá   — độ chênh to/nhỏ giữa âm nhấn và âm lướt (đọc đều = chênh thấp)
//   • Lên xuống  — cao độ có biến thiên không, và cuối câu có xuống (câu kể) hay
//                  lên (câu hỏi) đúng kiểu không
// Vì vậy gọi là "ngữ điệu (ước lượng)", không gọi là điểm tuyệt đối.

const WH = /^(?:who|what|when|where|why|how|which|whose|whom)\b/i;

function mean(list) {
  return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : 0;
}

function std(list) {
  if (list.length < 2) return 0;
  const avg = mean(list);
  return Math.sqrt(mean(list.map((value) => (value - avg) ** 2)));
}

/** Phân vị đơn giản trên một mảng số (0..1). */
function percentile(list, p) {
  if (!list.length) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[index];
}

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Hình mẫu ngữ điệu mong đợi của một câu, suy từ chữ: số cụm nhịp và hướng cao độ
 * cuối câu.
 * @param {string} text
 * @returns {{ groupCount: number, isQuestion: boolean, finalContour: "fall"|"rise", stresses: string[] }}
 */
export function expectedProsody(text) {
  const groups = rhythmGroups(text);
  const trimmed = String(text ?? "").trim();
  const isQuestion = /\?["')\]]*$/.test(trimmed);
  // Câu hỏi Yes/No lên giọng cuối; câu hỏi Wh- và câu kể xuống giọng.
  const finalContour = isQuestion && !WH.test(trimmed) ? "rise" : "fall";
  return {
    groupCount: Math.max(1, groups.length),
    isQuestion,
    finalContour,
    stresses: groups.map((group) => group.stress),
    source: "text",
  };
}

/**
 * Chuyển kết quả phân tích ngữ điệu của NGƯỜI TRONG VIDEO (từ /api/ai/prosody)
 * thành hình mẫu mong đợi cho scoreProsody. Thiếu dữ liệu thì lùi về ước lượng
 * từ văn bản.
 * @param {{stressedWords?: string[], pauseAfter?: string[], finalPitch?: string, pitchRange?: string} | null} ref
 * @param {string} text
 */
export function refToExpected(ref, text) {
  if (!ref || !Array.isArray(ref.stressedWords) || !ref.stressedWords.length) return expectedProsody(text);
  const stressCount = ref.stressedWords.length;
  const pauseCount = Array.isArray(ref.pauseAfter) ? ref.pauseAfter.length : Math.max(0, stressCount - 1);
  return {
    groupCount: Math.max(1, stressCount, pauseCount + 1),
    finalContour: ref.finalPitch === "rise" ? "rise" : "fall",
    stressCount,
    pauseCount,
    pitchRange: ["narrow", "medium", "wide"].includes(ref.pitchRange) ? ref.pitchRange : "medium",
    source: "model",
  };
}

/**
 * Rút đặc trưng thô từ dạng sóng: đường bao năng lượng (RMS) và cao độ (F0) theo
 * từng khung. Hàm thuần, không đụng DOM — nhận Float32Array/Array mẫu âm.
 * @param {ArrayLike<number>} samples
 * @param {number} sampleRate
 * @param {{hopMs?: number, winMs?: number, f0Min?: number, f0Max?: number}} [opts]
 * @returns {{ rms: number[], f0: number[], hopMs: number, sampleRate: number }}
 */
export function analyseWaveform(samples, sampleRate, opts = {}) {
  const rate = Number(sampleRate) || 16000;
  const hopMs = Math.max(5, Number(opts.hopMs) || 20);
  const winMs = Math.max(hopMs, Number(opts.winMs) || 45);
  const hop = Math.max(1, Math.round((hopMs / 1000) * rate));
  const win = Math.max(hop, Math.round((winMs / 1000) * rate));
  const f0Min = Math.max(50, Number(opts.f0Min) || 70);
  const f0Max = Math.min(rate / 2, Number(opts.f0Max) || 380);
  const minLag = Math.floor(rate / f0Max);
  const maxLag = Math.min(win - 1, Math.ceil(rate / f0Min));
  // Chặn trần thời lượng phân tích: tự tương quan là O(khung × lag × cửa sổ), để
  // đầu vào dài vô hạn thì treo giao diện.
  const total = Math.min(samples.length, Math.round(16 * rate));
  const rms = [];
  const f0 = [];
  if (!total || total < win) return { rms, f0, hopMs, sampleRate: rate };

  // Nền để loại khung im lặng khỏi việc dò cao độ.
  let globalPeak = 1e-6;
  for (let i = 0; i < total; i += 1) {
    const value = samples[i];
    if (value > globalPeak) globalPeak = value;
    else if (-value > globalPeak) globalPeak = -value;
  }
  const voiceFloor = globalPeak * 0.08;

  for (let start = 0; start + win <= total; start += hop) {
    // DC offset của khung.
    let sum = 0;
    for (let i = 0; i < win; i += 1) sum += samples[start + i];
    const dc = sum / win;

    let energy = 0;
    for (let i = 0; i < win; i += 1) {
      const value = samples[start + i] - dc;
      energy += value * value;
    }
    const frameRms = Math.sqrt(energy / win);
    rms.push(frameRms);

    if (frameRms < voiceFloor || maxLag <= minLag) {
      f0.push(0);
      continue;
    }

    // Tự tương quan chuẩn hoá; đỉnh cao nhất là chu kỳ cơ bản. Lấy mẫu cách quãng
    // 2 trong cửa sổ để nhẹ đi một nửa — đủ chính xác cho việc dò cao độ giọng.
    let bestLag = 0;
    let bestScore = 0;
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let corr = 0;
      for (let i = 0; i + lag < win; i += 2) {
        corr += (samples[start + i] - dc) * (samples[start + i + lag] - dc);
      }
      const score = corr / (energy || 1);
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }
    // energy tính trên toàn cửa sổ, corr lấy nửa mẫu → chuẩn theo 0.5.
    f0.push(bestScore > 0.2 && bestLag > 0 ? rate / bestLag : 0);
  }
  return { rms, f0, hopMs, sampleRate: rate };
}

/**
 * Chấm ngữ điệu từ đặc trưng đo được và hình mẫu mong đợi.
 * @param {{rms: number[], f0?: number[], hopMs: number}} measured
 * @param {{groupCount: number, finalContour?: string, stressCount?: number, pauseCount?: number, pitchRange?: string}} expected
 * @returns {{
 *   usable: boolean, score: number, rhythm: number, stress: number, melody: number|null,
 *   pauses: number, expectedPauses: number, dynamicDb: number, monotone: boolean, notes: string[]
 * }}
 */
export function scoreProsody(measured, expected) {
  const rms = Array.isArray(measured?.rms) ? measured.rms : [];
  const f0 = Array.isArray(measured?.f0) ? measured.f0 : [];
  const hopMs = Math.max(5, Number(measured?.hopMs) || 20);
  const groupCount = Math.max(1, Number(expected?.groupCount) || 1);
  const wantFall = (expected?.finalContour ?? "fall") !== "rise";
  // Số đỉnh nhấn và số lần ngắt mong đợi: lấy từ phân tích người nói trong video
  // nếu có, không thì suy từ số cụm nhịp của câu.
  const stressTarget = Number(expected?.stressCount) > 0 ? Number(expected.stressCount) : groupCount;
  const expectedPauses = Number.isFinite(Number(expected?.pauseCount))
    ? Math.min(6, Math.max(0, Math.round(Number(expected.pauseCount))))
    : Math.min(6, Math.max(0, groupCount - 1));
  // Biên độ cao độ mong đợi (hệ số biến thiên). null = dùng ngưỡng chung.
  const rangeTargets = { narrow: 0.05, medium: 0.09, wide: 0.14 };
  const targetCv = rangeTargets[expected?.pitchRange] ?? null;

  const peak = rms.length ? Math.max(...rms) : 0;
  // Ngưỡng có tiếng nói: vừa TƯƠNG ĐỐI (so với đỉnh) vừa TUYỆT ĐỐI (~-38 dBFS).
  // Bản ghi im lặng chỉ có nhiễu nền — đỉnh rất nhỏ mà ngưỡng tương đối lại kéo
  // theo nhiễu nên đếm nhầm ra "có tiếng". Ngưỡng tuyệt đối chặn trường hợp đó,
  // nhưng để thấp để giọng nói nhỏ / mic gain thấp vẫn đo được.
  const ABSOLUTE_FLOOR = 0.012;
  const speechFloor = Math.max(peak * 0.22, ABSOLUTE_FLOOR);
  const mask = rms.map((value) => value >= speechFloor);
  const speech = rms.filter((_, index) => mask[index]);
  const median = speech.length ? percentile(speech, 0.5) : 0;

  // Cả bản ghi gần như im lặng → không nói gì, không hiện điểm.
  if (peak < ABSOLUTE_FLOOR * 1.6 || median < ABSOLUTE_FLOOR) {
    return {
      usable: false, score: 0, rhythm: 0, stress: 0, melody: null,
      pauses: 0, expectedPauses, dynamicDb: 0, monotone: false,
      notes: ["Chưa nghe thấy bạn nói. Kiểm tra micro, hoặc nói to và gần máy hơn."],
    };
  }
  // Có tiếng nhưng quá ngắn để đo nhịp/ngữ điệu.
  if (speech.length * hopMs < 500) {
    return {
      usable: false, score: 0, rhythm: 0, stress: 0, melody: null,
      pauses: 0, expectedPauses, dynamicDb: 0, monotone: false,
      notes: ["Đoạn nói quá ngắn để đo ngữ điệu. Nhại trọn câu rồi thử lại."],
    };
  }

  // ── Nhịp ngắt: đếm khoảng lặng ≥160ms nằm GIỮA hai đoạn có tiếng ──────────
  const minPauseFrames = Math.max(1, Math.round(160 / hopMs));
  let pauses = 0;
  let run = 0;
  let sawSpeech = false;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index]) {
      if (run >= minPauseFrames && sawSpeech) pauses += 1;
      run = 0;
      sawSpeech = true;
    } else if (sawSpeech) {
      run += 1;
    }
  }
  // (khoảng lặng ở đuôi không tính vì vòng lặp chỉ cộng khi gặp lại tiếng nói)
  const pauseDiff = Math.abs(pauses - expectedPauses);
  let rhythm = clamp01(1 - pauseDiff / (expectedPauses + 1.5));
  if (expectedPauses >= 2 && pauses === 0) rhythm *= 0.5; // đọc một mạch không ngắt

  // ── Nhấn nhá: độ chênh to/nhỏ + số đỉnh nhấn ────────────────────────────
  const loud = percentile(speech, 0.92);
  const soft = percentile(speech, 0.2);
  const dynamicDb = 20 * Math.log10(Math.max(loud, 1e-5) / Math.max(soft, 1e-5));
  const dynScore = clamp01((dynamicDb - 3) / 9); // 3dB→0, 12dB→1

  // Làm mượt rồi đếm cực đại địa phương vượt 1.3× trung bình lân cận (~240ms).
  const smooth = speech.map((_, index) => {
    let acc = 0;
    let count = 0;
    for (let k = -1; k <= 1; k += 1) {
      const j = index + k;
      if (j >= 0 && j < speech.length) { acc += speech[j]; count += 1; }
    }
    return acc / count;
  });
  const window = Math.max(3, Math.round(240 / hopMs));
  let peakCount = 0;
  for (let index = 1; index < smooth.length - 1; index += 1) {
    if (smooth[index] <= smooth[index - 1] || smooth[index] < smooth[index + 1]) continue;
    let acc = 0;
    let count = 0;
    for (let j = index - window; j <= index + window; j += 1) {
      if (j >= 0 && j < smooth.length) { acc += smooth[j]; count += 1; }
    }
    if (smooth[index] >= 1.3 * (acc / count)) peakCount += 1;
  }
  const peakScore = clamp01(1 - Math.abs(peakCount - stressTarget) / (stressTarget + 2));
  const stress = clamp01(0.6 * dynScore + 0.4 * peakScore);

  // ── Lên xuống giọng: chỉ khi dò được đủ khung hữu thanh ─────────────────
  const voiced = f0.filter((value) => value > 0);
  let melody = null;
  let monotone = false;
  if (voiced.length >= 8) {
    const avgF0 = mean(voiced);
    const cv = avgF0 ? std(voiced) / avgF0 : 0;
    monotone = cv < 0.045;
    // Có biên độ mục tiêu từ video → chấm theo mức khớp; không thì theo ngưỡng chung.
    const varScore = targetCv
      ? clamp01(1 - Math.abs(cv - targetCv) / (targetCv + 0.05))
      : clamp01((cv - 0.03) / 0.13); // gần như phẳng → 0

    const tail = voiced.slice(Math.floor(voiced.length * 0.75));
    const body = voiced.slice(Math.floor(voiced.length * 0.3), Math.floor(voiced.length * 0.7));
    const delta = body.length && tail.length ? (mean(tail) - mean(body)) / mean(body) : 0;
    const contourScore = wantFall
      ? clamp01((0.03 - delta) / 0.13) // xuống giọng → delta âm → điểm cao
      : clamp01((delta + 0.03) / 0.13); // lên giọng → delta dương → điểm cao
    melody = clamp01(0.5 * varScore + 0.5 * contourScore);
  }

  const score = melody === null
    ? Math.round((0.42 * rhythm + 0.58 * stress) * 100)
    : Math.round((0.3 * rhythm + 0.38 * stress + 0.32 * melody) * 100);

  const notes = [];
  if (rhythm < 0.55) {
    notes.push(
      pauses < expectedPauses
        ? "Bạn đọc gần như một mạch. Ngắt hơi nhẹ ở ranh giới cụm như câu mẫu để câu có nhịp."
        : "Ngắt hơi hơi vụn. Gom lại thành vài cụm dài, mỗi cụm một ý.",
    );
  }
  if (stress < 0.5) notes.push("Giọng đang khá đều. Đọc bật hẳn từ mang trọng âm lên, hạ các từ chức năng xuống — chênh lệch to–nhỏ chính là nhịp tiếng Anh.");
  if (monotone) notes.push("Cao độ gần như không đổi trong cả câu. Cho giọng nhấp nhô theo câu mẫu.");
  if (melody !== null && melody < 0.5 && !monotone) {
    notes.push(wantFall
      ? "Cuối câu kể nên hạ giọng xuống dứt khoát."
      : "Cuối câu hỏi Yes/No nên nâng giọng lên.");
  }
  if (!notes.length) notes.push("Ngữ điệu bám khá sát hình mẫu của câu.");

  return {
    usable: true,
    score,
    rhythm: Math.round(rhythm * 100),
    stress: Math.round(stress * 100),
    melody: melody === null ? null : Math.round(melody * 100),
    pauses,
    expectedPauses,
    dynamicDb: Math.round(dynamicDb * 10) / 10,
    monotone,
    notes,
  };
}
