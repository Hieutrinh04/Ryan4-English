"use client";

import { useEffect, useRef } from "react";

/**
 * Đóng lớp phủ bằng phím Escape.
 *
 * Sáu hộp thoại trong app đóng được bằng cách bấm ra vùng mờ bên ngoài, nhưng
 * bấm ra ngoài là thao tác của chuột. Ai dùng bàn phím mở hộp thoại lên rồi thì
 * chỉ còn cách lần cho tới đúng nút ×. Escape là phím mà mọi người đều thử đầu
 * tiên, và trước đây nó không làm gì cả.
 *
 * Giữ hàm gọi trong một ref: hộp thoại nào cũng truyền hàm viết thẳng tại chỗ
 * nên danh tính hàm đổi sau mỗi lần vẽ lại; không giữ ref thì cứ mỗi lần vẽ lại
 * là gỡ ra rồi gắn lại người nghe sự kiện.
 */
export function useEscape(onEscape: () => void, active = true) {
  const latest = useRef(onEscape);

  useEffect(() => {
    latest.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") latest.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active]);
}
