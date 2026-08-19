import { supabase } from "./supabase";

// Đẩy bài dịch đã chấm lên Supabase.
//
// Nguyên tắc: localStorage là nguồn chính, cloud là bản sao. Người chưa đăng nhập —
// tức gần như toàn bộ người dùng hôm nay — vẫn phải dùng được đầy đủ. Vì vậy mọi
// hàm ở đây đều lặng lẽ bỏ qua khi chưa đăng nhập, và nuốt lỗi mạng thay vì ném ra.
// Mất một dòng thống kê không đáng để hỏng một buổi học.
//
// Lược đồ ở supabase/schema.sql. Chưa áp dụng lược đồ thì các lệnh dưới đây trả về
// lỗi và bị bỏ qua — app vẫn chạy bình thường.

type Issue = { type?: string; wrong?: string; right?: string; why?: string };

export type AttemptPayload = {
  term: string;
  vietnamese: string;
  reference: string;
  answer: string;
  score: number;
  correct: boolean;
  gradedBy: "llm" | "reference";
  corrected?: string;
  comment?: string;
  issues?: Issue[];
  errorTypes: string[];
};

async function currentUserId() {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Ghi một lượt dịch: bài tập, bài làm, và từng lỗi cụ thể.
 *
 * Trả về id của lượt vừa ghi, hoặc null khi không ghi được vì bất kỳ lý do gì.
 * Người gọi không cần xử lý gì với null — dữ liệu đã nằm an toàn ở localStorage.
 */
export async function pushTranslationAttempt(payload: AttemptPayload): Promise<string | null> {
  const userId = await currentUserId();
  if (!supabase || !userId) return null;

  try {
    const { data: exercise, error: exerciseError } = await supabase
      .from("translation_exercises")
      .insert({
        user_id: userId,
        source_vi: payload.vietnamese,
        reference_en: payload.reference,
        target_words: payload.term ? [payload.term] : [],
      })
      .select("id")
      .single();
    if (exerciseError || !exercise) return null;

    const { data: attempt, error: attemptError } = await supabase
      .from("translation_attempts")
      .insert({
        user_id: userId,
        exercise_id: exercise.id,
        answer: payload.answer,
        score: payload.score,
        is_correct: payload.correct,
        corrected: payload.corrected ?? null,
        ai_comment: payload.comment ?? null,
        graded_by: payload.gradedBy,
      })
      .select("id")
      .single();
    if (attemptError || !attempt) return null;

    // Mỗi lỗi một dòng. Khi mô hình chấm thì có kèm chỗ sai và giải thích; khi chỉ
    // so câu mẫu thì chỉ có nhãn, nên các cột kia để trống thay vì bịa ra nội dung.
    const events = payload.issues?.length
      ? payload.issues.map((issue) => ({
          user_id: userId,
          attempt_id: attempt.id,
          error_type: issue.type ?? "other",
          wrong_text: issue.wrong ?? null,
          correct_text: issue.right ?? null,
          explanation: issue.why ?? null,
        }))
      : payload.errorTypes.map((type) => ({ user_id: userId, attempt_id: attempt.id, error_type: type }));

    if (events.length) await supabase.from("error_events").insert(events);
    return attempt.id;
  } catch {
    // Mạng hỏng, chưa áp lược đồ, hoặc RLS chặn — đều không phải việc người học
    // phải bận tâm. Bản ghi ở localStorage vẫn đầy đủ.
    return null;
  }
}
