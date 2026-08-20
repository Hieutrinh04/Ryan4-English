"use client";

import { useState } from "react";
import Icon from "./Icon";

// Màn hình vào của Dictation và Shadowing.
//
// Trước đây hai màn này bắt chọn folder TỪ VỰNG trước, rồi hiện chồng bảng chọn
// bài video lên trên thư viện bài có sẵn — hai màn hình khác nhau trên cùng một
// trang, và folder từ vựng thì chẳng liên quan gì tới bài nghe.
//
// Nay chỉ còn một thư viện: bài lấy từ video và bài có sẵn nằm chung một chỗ,
// lọc bằng cùng một hàng nút.

export type VideoLessonCard = {
  id: string;
  videoId: string;
  title: string;
  author: string;
  seconds: number;
  source: string;
  // Giữ đúng dạng câu như nơi khác dùng: khai báo hẹp hơn thì chỗ gọi phải ép kiểu.
  sentences: { index: number; start: number; end: number; text: string }[];
};

type Filter = "all" | "video" | "builtin";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "Tất cả" },
  { value: "video", label: "Từ video" },
  { value: "builtin", label: "Bài có sẵn" },
];

function minutes(seconds: number) {
  if (!seconds) return "";
  return `${Math.max(1, Math.round(seconds / 60))} phút`;
}

export default function LessonLibrary({
  mode,
  lessons,
  pickVideo,
  pickBuiltIn,
  close,
}: {
  mode: "dictation" | "shadowing";
  lessons: VideoLessonCard[];
  pickVideo: (lesson: VideoLessonCard) => void;
  pickBuiltIn: () => void;
  close: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const showVideo = filter !== "builtin";
  const showBuiltIn = filter !== "video";

  return (
    <div className="page lesson-library">
      <button className="back" onClick={close}>← Chọn chức năng khác</button>
      <div className="eyebrow">LUYỆN NGHE</div>
      <h1>{mode === "dictation" ? "Nghe chép chính tả" : "Nói nhại theo câu mẫu"}</h1>
      <p className="page-sub">
        {mode === "dictation"
          ? "Nghe từng câu rồi gõ lại đúng những gì nghe được."
          : "Nghe câu mẫu, nói đuổi theo, rồi xem máy nghe ra được bao nhiêu phần lời của bạn."}
      </p>

      <div className="library-filters" role="group" aria-label="Lọc bài">
        {FILTERS.map((item) => (
          <button key={item.value} className={filter === item.value ? "active" : ""} onClick={() => setFilter(item.value)}>
            {item.label}
            {item.value === "video" && lessons.length > 0 && <em>{lessons.length}</em>}
          </button>
        ))}
      </div>

      {showVideo && (
        <section className="library-block">
          <h3>Bài từ video</h3>
          {lessons.length ? (
            <div className="library-grid">
              {lessons.map((lesson) => (
                <button key={lesson.id} className="library-card video" onClick={() => pickVideo(lesson)}>
                  {/* Ảnh bìa lấy thẳng từ YouTube theo mã video, không phải tải về lưu. */}
                  <span className="library-thumb" style={{ backgroundImage: `url(https://i.ytimg.com/vi/${lesson.videoId}/mqdefault.jpg)` }} />
                  <b>{lesson.title}</b>
                  <small>{[lesson.author, `${lesson.sentences.length} câu`, minutes(lesson.seconds)].filter(Boolean).join(" · ")}</small>
                </button>
              ))}
            </div>
          ) : (
            // Chưa có bài thì phải nói rõ cách lấy, chứ không để một ô trống khiến
            // người dùng tưởng tính năng chưa tồn tại.
            <div className="library-empty">
              <Icon name="headphones" size={22} />
              <div>
                <b>Chưa có bài nào từ video</b>
                <p>
                  Cài tiện ích Lexilo cho trình duyệt (thư mục <code>extension/</code>), mở một video YouTube có phụ đề
                  rồi bấm biểu tượng Lexilo. Bài sẽ hiện ở đây.
                </p>
              </div>
            </div>
          )}
        </section>
      )}

      {showBuiltIn && (
        <section className="library-block">
          <h3>Bài có sẵn</h3>
          <div className="library-grid">
            <button className="library-card builtin" onClick={pickBuiltIn}>
              <span className="library-thumb plain"><Icon name="book" size={24} /></span>
              <b>Thư viện bài luyện sẵn</b>
              <small>VOA, đời sống, du lịch, công việc, công nghệ · chọn theo chủ đề và trình độ</small>
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
