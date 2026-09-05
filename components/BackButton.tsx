"use client";

type BackButtonProps = {
  destination: string;
  onClick: () => void;
};

/**
 * Một mẫu nút lùi duy nhất cho mọi màn con.
 * `destination` luôn nói rõ nơi người dùng sẽ trở về, thay vì các nhãn mơ hồ
 * như "Chọn chức năng khác" hoặc chỉ hiện một mũi tên.
 */
export default function BackButton({ destination, onClick }: BackButtonProps) {
  return (
    <button
      type="button"
      className="back app-back-button"
      onClick={onClick}
      aria-label={`Quay lại ${destination}`}
    >
      <span aria-hidden="true">←</span>
      <span>Quay lại {destination}</span>
    </button>
  );
}
