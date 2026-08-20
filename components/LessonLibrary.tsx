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
  { value: "video", label: "Video của tôi" },
  { value: "builtin", label: "Thư viện Lexilo" },
];

const TOPICS = ["BBC Learning English", "Hội thoại", "Công việc", "Du lịch", "Công nghệ", "IELTS", "TOEIC"];
const LEVELS = ["Tất cả cấp độ", "A1", "A2", "B1", "B2", "C1"];

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
  const [topic, setTopic] = useState("Tất cả");
  const [level, setLevel] = useState("Tất cả cấp độ");
  const showVideo = filter !== "builtin";
  const showBuiltIn = filter !== "video";

  return (
    <div className="page lesson-library lesson-library-v2">
      <header className="library-hero">
        <div className="library-title-row">
          <button className="library-back" onClick={close} aria-label="Quay lại">←</button>
          <span className="library-mode-icon"><Icon name={mode === "dictation" ? "headphones" : "mic"} size={19} /></span>
          <div>
            <h1>{mode === "dictation" ? "Luyện Dictation" : "Luyện Shadowing"}</h1>
            <p>{mode === "dictation" ? "Chọn chủ đề để luyện kỹ năng nghe" : "Chọn chủ đề để luyện kỹ năng nói"}</p>
          </div>
        </div>
        <div className="library-summary"><span>▣ <b>{lessons.length}</b> đang học</span><i /> <span className="complete">✓ <b>0</b> đã hoàn thành</span></div>
      </header>

      <div className="library-filter-panel">
        <div className="library-filters" role="group" aria-label="Lọc nguồn bài">
          {FILTERS.map((item) => (
            <button key={item.value} className={filter === item.value ? "active" : ""} onClick={() => setFilter(item.value)}>
              {item.label}{item.value === "video" && lessons.length > 0 && <em>{lessons.length}</em>}
            </button>
          ))}
        </div>
        <div className="library-chip-row" role="group" aria-label="Lọc chủ đề">
          {["Tất cả", ...TOPICS].map((item) => <button key={item} className={topic === item ? "active" : ""} onClick={() => setTopic(item)}>{item}</button>)}
        </div>
        <div className="library-chip-row levels" role="group" aria-label="Lọc cấp độ">
          {LEVELS.map((item) => <button key={item} className={level === item ? "active" : ""} onClick={() => setLevel(item)}>{item}</button>)}
        </div>
      </div>

      {showVideo && (
        <section className="library-block">
          <div className="library-section-title"><h2>Tiếp tục học</h2><span>{lessons.length ? `${lessons.length} bài của bạn` : "Thêm video từ YouTube để bắt đầu"}</span></div>
          {lessons.length ? (
            <div className="library-grid">
              {lessons.map((lesson) => (
                <button key={lesson.id} className="library-card video" onClick={() => pickVideo(lesson)}>
                  {/* Ảnh bìa lấy thẳng từ YouTube theo mã video, không phải tải về lưu. */}
                  <span className="library-thumb" style={{ backgroundImage: `url(https://i.ytimg.com/vi/${lesson.videoId}/mqdefault.jpg)` }}>
                    <em className="level-badge">B1</em><em className="duration-badge">◷ {minutes(lesson.seconds)}</em>
                  </span>
                  <span className="library-card-copy"><b>{lesson.title}</b><small>{lesson.author || "Video của tôi"}</small><strong>{lesson.sentences.length} phân đoạn</strong></span>
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
          <div className="library-section-title"><h2>Bài học mới</h2><span>Chọn theo chủ đề và trình độ</span></div>
          <div className="library-grid">
            <button className="library-card builtin" onClick={pickBuiltIn}>
              <span className="library-thumb plain"><em className="level-badge orange">A1–C1</em><Icon name="book" size={34} /><span>LEXILO LISTENING</span></span>
              <span className="library-card-copy"><b>Khám phá thư viện bài luyện</b><small>Đời sống · Du lịch · Công việc · Công nghệ</small><strong>Chọn bài theo cấp độ →</strong></span>
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
