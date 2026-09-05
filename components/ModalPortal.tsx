"use client";

import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * Đưa hộp thoại ra thẳng <body>.
 *
 * Vì sao cần: .page mang animation "page-in" với fill-mode "both", nên chạy xong
 * nó vẫn ở trạng thái điền và transform tính ra matrix(1,0,0,1,0,0). Một
 * transform — dù chỉ là ma trận đơn vị — biến phần tử thành khung chứa cho mọi
 * position:fixed bên trong. Hộp thoại vì thế neo vào .page thay vì khung nhìn,
 * và trôi theo trang khi cuộn.
 *
 * Bỏ animation thì mất hiệu ứng vào trang. Đổi fill-mode sang "backwards" thì
 * hỏng ở chế độ giảm chuyển động: khối prefers-reduced-motion ép
 * animation-duration về 0.01ms nhưng không đụng fill-mode, nên trang kẹt vĩnh
 * viễn ở khung hình đầu. Portal là cách duy nhất miễn nhiễm với CSS của tổ tiên,
 * hôm nay lẫn về sau.
 *
 * Vỏ bọc vẫn mang lớp .lexilo-workspace vì hàng trăm luật giao diện bọc trong
 * lớp đó; ra khỏi nó là hộp thoại mất kiểu. `display:contents` khiến vỏ không
 * sinh hộp nào, nên min-height và nền của .lexilo-workspace không vẽ ra gì.
 */
export default function ModalPortal({ children }: { children: ReactNode }) {
  // Máy chủ không có document; đợi tới lượt vẽ trên trình duyệt mới dựng.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="lexilo-workspace modal-host">{children}</div>,
    document.body,
  );
}
