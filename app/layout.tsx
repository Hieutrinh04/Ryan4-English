import type { Metadata } from "next";
import { Quicksand } from "next/font/google";
import "./globals.css";
import "./extras.css";

// Tự host font thay vì gọi Google Fonts lúc chạy: bớt một vòng kết nối ra ngoài,
// không nhảy chữ khi tải, và không gửi thông tin người dùng sang máy chủ thứ ba.
const quicksand = Quicksand({ subsets: ["latin", "vietnamese"], weight: ["400", "500", "600", "700"], display: "swap", variable: "--font-quicksand" });

export const metadata: Metadata = {
  title: "Lexilo — Học từ vựng thông minh",
  description: "Ghi nhớ từ vựng bền vững với spaced repetition và chủ động gợi nhớ.",
  metadataBase: new URL("https://lexilo.pages.dev"),
  openGraph: {
    title: "Lexilo — Học từ vựng thông minh",
    description: "Ghi nhớ từ vựng. Dùng được mỗi ngày.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Lexilo" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

// Script này chạy lúc trình duyệt đọc HTML, tức TRƯỚC mọi mô-đun JavaScript.
// Hai việc:
//   1. Đặt sẵn chủ đề sáng để trang không chớp màu khi tải.
//   2. Nuốt lỗi do tiện ích trình duyệt ném ra. Tiện ích Google Dịch ném lỗi của
//      chính nó ra window, và ô báo lỗi của dev server hiện nó lên như thể app hỏng.
//      Phải chặn ở đây chứ không phải trong component: ô báo lỗi đăng ký lắng nghe
//      ngay khi mô-đun dev nạp, mà listener cùng một đích chạy theo thứ tự đăng ký —
//      đăng ký sau thì không cản được. Chỉ nuốt khi TOÀN BỘ stack nằm trong
//      chrome-extension:// hoặc moz-extension://, nên lỗi thật của app vẫn hiện.
const bootScript = `
try{
  var THEMES={sang:[250,"light"],toi:[250,"dark"],"tim-sang":[285,"light"],"tim-toi":[285,"dark"],
    "hong-sang":[335,"light"],"hong-toi":[335,"dark"],"xanh-sang":[205,"light"],"xanh-toi":[205,"dark"]};
  var t=localStorage.getItem("lexilo:theme");
  if(t==="light")t="sang"; else if(t==="dark")t="toi";
  var picked=THEMES[t]||THEMES.toi;
  document.documentElement.dataset.theme=picked[1];
  document.documentElement.dataset.hue=String(picked[0]);
}catch(e){}
(function(){
  function onlyExtension(stack){
    if(!stack) return false;
    var frames = String(stack).split("\\n").filter(function(line){ return /\\s+at\\s|@/.test(line); });
    return frames.length > 0 && frames.every(function(line){ return line.indexOf("-extension://") > -1; });
  }
  window.addEventListener("unhandledrejection", function(event){
    var reason = event.reason;
    if(!reason || !onlyExtension(reason.stack)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  window.addEventListener("error", function(event){
    if(!event.filename || event.filename.indexOf("-extension://") === -1) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" suppressHydrationWarning className={quicksand.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
