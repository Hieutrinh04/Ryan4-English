// Bộ biểu tượng dạng nét, vẽ thẳng bằng SVG.
//
// Trước đây giao diện dùng ký tự Unicode (⌂ ▤ ◖)) ◐ ✍ ⌕). Mỗi ký tự do một phông
// khác nhau vẽ ra nên to nhỏ và dày mỏng không đều, có cái còn không có trong
// phông và hiện thành ô vuông. Vẽ bằng SVG thì mọi biểu tượng cùng khung 24, cùng
// độ dày nét, và ăn theo màu chữ của chỗ đặt nó.

export type IconName =
  | "home" | "chart" | "headphones" | "mic" | "pen" | "book" | "list" | "search"
  | "compass" | "sun" | "moon" | "plus" | "chevron" | "flame" | "clock" | "target"
  | "cards" | "keyboard" | "volume" | "swap" | "blank" | "shuffle" | "check" | "trophy"
  | "play" | "previous" | "replay" | "sparkles" | "arrow" | "stop";

const PATHS: Record<IconName, string> = {
  home: "M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  headphones: "M4 15v-3a8 8 0 0 1 16 0v3M4 14h2.5a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zm16 0h-2.5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1H19a1 1 0 0 0 1-1z",
  mic: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7",
  pen: "M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4",
  book: "M4 4.5h6a3 3 0 0 1 2 2.8V20a2.4 2.4 0 0 0-2-1.6H4zm16 0h-6a3 3 0 0 0-2 2.8V20a2.4 2.4 0 0 1 2-1.6h6z",
  list: "M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
  compass: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5z",
  sun: "M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  moon: "M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z",
  plus: "M12 5v14M5 12h14",
  chevron: "m6 9 6 6 6-6",
  flame: "M12 22a6 6 0 0 0 6-6c0-4-3-5.5-3-9 0 0-2 1.5-2 4 0-2.5-2.5-4-2.5-4C10.5 9 6 11 6 16a6 6 0 0 0 6 6z",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2",
  target: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm0 3.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z",
  cards: "M3.5 6.5h17v11h-17zM3.5 10h17",
  keyboard: "M3 6.5h18v11H3zM6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M6.5 13.5h.01M17 13.5h.01M9.5 13.5h5",
  volume: "M11 5 6.5 9H3v6h3.5L11 19zM15 9.5a3.5 3.5 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10",
  swap: "M4 8h13l-3-3M20 16H7l3 3",
  blank: "M4 6.5h16v11H4zM8.5 12h7",
  shuffle: "M3 6h3l4 6 4 6h4M3 18h3l4-6M17 3l3 3-3 3M17 15l3 3-3 3",
  check: "m4 12.5 5 5 11-11",
  trophy: "M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 14v4M8.5 20h7",
  play: "m8 5 11 7-11 7z",
  previous: "M6 5v14M18 6l-8 6 8 6z",
  replay: "M5 8V4m0 0h4M5 4l3 3a7 7 0 1 1-2 9",
  sparkles: "m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2zM5 14l.7 2.3L8 17l-2.3.7L5 20l-.7-2.3L2 17l2.3-.7zM19 14l.6 1.9 1.9.6-1.9.6L19 19l-.6-1.9-1.9-.6 1.9-.6z",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  stop: "M7 7h10v10H7z",
};

/** Biểu tượng nét, thừa hưởng màu chữ (currentColor) của phần tử chứa nó. */
export default function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      // Biểu tượng chỉ để trang trí: nhãn chữ ngay bên cạnh đã nói đủ nghĩa, đọc
      // thêm tên biểu tượng chỉ làm trình đọc màn hình lặp lại.
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
