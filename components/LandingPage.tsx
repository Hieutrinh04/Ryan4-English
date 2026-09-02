"use client";

import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";

type LandingPageProps = {
  loading?: boolean;
  openSignIn: () => void;
  openSignUp: () => void;
};

const benefits = [
  "Học từ trong câu thật, không học thuộc danh sách rời rạc",
  "Luyện nghe, nói, viết và dịch trên cùng một lộ trình",
  "AI sửa lỗi rõ ràng bằng cả tiếng Việt và tiếng Anh",
];

const activePractice = [
  ["⌨", "Nghe và tự tay chép lại", "Tìm đúng âm bạn thường nghe hụt thay vì chỉ xem phụ đề."],
  ["◉", "Nói theo và nhận phản hồi", "So nhịp, trọng âm và độ trôi chảy với giọng gốc."],
  ["✎", "Tự viết, tự dịch", "Biến vốn từ đã học thành câu của chính bạn."],
  ["↻", "Ôn đúng lúc sắp quên", "Lịch ôn tự thích nghi theo từng lần nhớ và quên."],
];

const faqs = [
  ["Lexilo phù hợp với ai?", "Lexilo dành cho người muốn biến vốn từ thụ động thành khả năng nghe, nói và viết thật — từ người mới học đến người đang luyện IELTS."],
  ["Tôi có thể bắt đầu miễn phí không?", "Có. Bạn có thể tạo tài khoản miễn phí, lưu tiến độ và trải nghiệm các chế độ luyện cốt lõi trước khi quyết định nâng cấp."],
  ["Lexilo có chỉ dùng để học từ vựng không?", "Không. Từ vựng là điểm xuất phát; bạn sẽ dùng chúng trong nghe chép, shadowing, luyện nói, viết và dịch Việt–Anh."],
  ["AI chấm bài bằng tiếng Việt hay tiếng Anh?", "Cả hai. Lexilo chỉ ra lỗi bằng tiếng Việt dễ hiểu, đồng thời đưa câu tiếng Anh tự nhiên để bạn học cách sửa."],
  ["Tôi có thể học từ video YouTube của mình không?", "Có. Bạn có thể thêm video phù hợp, luyện theo từng đoạn ngắn và lưu lại từ vựng xuất hiện trong bài."],
];

export default function LandingPage({ loading = false, openSignIn, openSignUp }: LandingPageProps) {
  const shellRef = useRef<HTMLElement>(null);
  const productRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      shell.querySelectorAll<HTMLElement>("[data-landing-reveal]").forEach((element) => {
        element.classList.add("is-visible");
      });
      return;
    }

    shell.classList.add("landing-motion-ready");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.18, rootMargin: "0px 0px -40px" });

    shell.querySelectorAll<HTMLElement>("[data-landing-reveal]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  const handleProductPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const product = productRef.current;
    if (!product) return;
    const rect = product.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    product.style.setProperty("--landing-tilt-x", `${(-y * 7).toFixed(2)}deg`);
    product.style.setProperty("--landing-tilt-y", `${(x * 9).toFixed(2)}deg`);
    product.style.setProperty("--landing-light-x", `${((x + 0.5) * 100).toFixed(1)}%`);
    product.style.setProperty("--landing-light-y", `${((y + 0.5) * 100).toFixed(1)}%`);
  };

  const resetProductTilt = () => {
    const product = productRef.current;
    if (!product) return;
    product.style.setProperty("--landing-tilt-x", "0deg");
    product.style.setProperty("--landing-tilt-y", "0deg");
    product.style.setProperty("--landing-light-x", "70%");
    product.style.setProperty("--landing-light-y", "30%");
  };

  return (
    <main className="landing-shell" ref={shellRef}>
      <div className="landing-grid" aria-hidden="true" />
      <div className="landing-glow landing-glow-one" />
      <div className="landing-glow landing-glow-two" />
      <div className="landing-glow landing-glow-three" />
      <div className="landing-particles" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => <i key={index} />)}
      </div>
      <header className="landing-header">
        <a className="landing-brand" href="#top" aria-label="Lexilo — Trang chủ">
          <span>L</span>
          <b>Lexilo</b>
        </a>
        <nav aria-label="Điều hướng trang giới thiệu">
          <a href="#method">Phương pháp</a>
          <a href="#features">Luyện tập</a>
          <a href="#ecosystem">Sản phẩm</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="landing-auth-actions">
          <button className="landing-login" disabled={loading} onClick={openSignIn}>Đăng nhập</button>
          <button className="landing-signup" disabled={loading} onClick={openSignUp}>Đăng ký miễn phí</button>
        </div>
      </header>

      <section className="landing-hero" id="top">
        <div className="landing-copy">
          <div className="landing-kickers">
            <span>✦ Học chủ động</span>
            <span>✓ Bắt đầu miễn phí</span>
          </div>
          <h1>Học tiếng Anh<br /><em>thông minh hơn,</em><br />dùng được mỗi ngày</h1>
          <p>Lexilo biến từ vựng của bạn thành bài nghe, nói và luyện dịch có ngữ cảnh — kèm phản hồi song ngữ để bạn biết mình sai ở đâu và sửa thế nào.</p>
          <div className="landing-hero-actions">
            <button className="landing-primary" disabled={loading} onClick={openSignUp}>{loading ? "Đang kiểm tra phiên…" : "✦ Học miễn phí ngay"}</button>
            <button className="landing-secondary" disabled={loading} onClick={openSignIn}>Đã có tài khoản →</button>
          </div>
          <ul>
            {benefits.map((benefit) => <li key={benefit}><span>✓</span>{benefit}</li>)}
          </ul>
          <div className="landing-proof"><b>983+</b> từ vựng theo chủ đề <i /> <b>7</b> chế độ luyện tập <i /> <b>AI</b> hướng dẫn song ngữ</div>
        </div>

        <div className="landing-product-stage">
          <div
            className="landing-product"
            ref={productRef}
            onPointerMove={handleProductPointerMove}
            onPointerLeave={resetProductTilt}
            aria-label="Xem trước giao diện học Lexilo"
          >
            <div className="landing-product-light" aria-hidden="true" />
            <div className="landing-browser-bar"><span /><span /><span /><b>lexilo.app</b></div>
            <div className="landing-product-body">
              <aside>
                <div className="landing-mini-brand"><i>L</i><b>Lexilo</b></div>
                <span className="active">⌂ <b>Trang chủ</b></span>
                <span>◫ Tiến độ</span>
                <small>LUYỆN TẬP</small>
                <span>◉ Nghe chép</span>
                <span>♬ Nói nhại</span>
                <span>✎ Luyện viết</span>
                <span>▤ Từ vựng</span>
              </aside>
              <section>
                <div className="landing-preview-head"><span>CHÀO BUỔI SÁNG</span><b>Tiếp tục hành trình của bạn</b></div>
                <div className="landing-preview-hero">
                  <div><small>MỤC TIÊU HÔM NAY</small><b>12 từ đang chờ bạn</b><span>Ôn đúng lúc để ghi nhớ lâu hơn.</span></div>
                  <button>Học ngay →</button>
                </div>
                <div className="landing-preview-stats">
                  <article><i>▤</i><span>Từ đã học</span><b>248</b></article>
                  <article><i>✓</i><span>Đã thuộc</span><b>96</b></article>
                  <article><i>◷</i><span>Phút luyện</span><b>385</b></article>
                </div>
                <div className="landing-preview-grid">
                  <article>
                    <header><b>Tiến độ tuần này</b><span>68%</span></header>
                    <div className="landing-bars"><i /><i /><i /><i /><i /><i /><i /></div>
                    <small>T2&nbsp;&nbsp; T3&nbsp;&nbsp; T4&nbsp;&nbsp; T5&nbsp;&nbsp; T6&nbsp;&nbsp; T7&nbsp;&nbsp; CN</small>
                  </article>
                  <article className="landing-next-lesson">
                    <small>TIẾP TỤC HỌC</small>
                    <b>Luyện dịch theo từng câu</b>
                    <span>Body &amp; Appearance · 5 câu</span>
                    <button>Tiếp tục →</button>
                  </article>
                </div>
              </section>
            </div>
            <div className="landing-float-card float-ai"><span>AI</span><div><b>Sửa lỗi thông minh</b><small>Giải thích bằng tiếng Việt</small></div></div>
            <div className="landing-float-card float-streak"><span>🔥</span><div><b>7 ngày liên tiếp</b><small>Bạn đang tiến bộ rất tốt</small></div></div>
          </div>
        </div>
      </section>

      <section className="landing-signal landing-reveal" data-landing-reveal aria-label="Điểm nổi bật của Lexilo">
        <div><b>983+</b><span>Từ vựng theo chủ đề</span></div>
        <i />
        <div><b>7</b><span>Chế độ luyện chủ động</span></div>
        <i />
        <div><b>4</b><span>Kỹ năng trong một lộ trình</span></div>
        <i />
        <div><b>AI</b><span>Phản hồi song ngữ</span></div>
      </section>

      <section className="landing-section landing-method-section" id="method">
        <header className="landing-section-head landing-reveal" data-landing-reveal>
          <span>PHƯƠNG PHÁP LEXILO</span>
          <h2>Đừng chỉ “biết” một từ.<br /><em>Hãy thật sự dùng được nó.</em></h2>
          <p>Một vòng luyện ngắn nhưng chủ động giúp bạn nhớ sâu hơn việc xem và đọc phụ đề liên tục.</p>
        </header>

        <div className="landing-compare landing-reveal" data-landing-reveal>
          <article className="is-passive">
            <small>CÁCH HỌC THỤ ĐỘNG</small>
            <h3>Xem xong rồi… để đó</h3>
            <ul>
              <li><i>×</i> Tra một từ rồi quên sau vài phút</li>
              <li><i>×</i> Hiểu khi đọc nhưng không tự nói được</li>
              <li><i>×</i> Không biết mình đang yếu ở đâu</li>
              <li><i>×</i> Học nhiều nhưng tiến bộ khó đo lường</li>
            </ul>
          </article>
          <div className="landing-vs">VS</div>
          <article className="is-active">
            <div className="landing-recommended">LEXILO KHUYÊN DÙNG</div>
            <small>THỰC HÀNH CHỦ ĐỘNG</small>
            <h3>Chạm vào từng kỹ năng</h3>
            <div className="landing-active-grid">
              {activePractice.map(([icon, title, description]) => (
                <div key={title}><i>{icon}</i><span><b>{title}</b><small>{description}</small></span></div>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section className="landing-section landing-practice-section" id="features">
        <header className="landing-section-head landing-reveal" data-landing-reveal>
          <span>LUYỆN ĐỦ BỐN KỸ NĂNG</span>
          <h2>Mỗi lần luyện đều tạo ra<br /><em>một thay đổi nhìn thấy được</em></h2>
          <p>Học với video thật, câu thật và phản hồi cụ thể — mọi hoạt động đều nối về cùng kho từ của bạn.</p>
        </header>

        <article className="landing-showcase landing-reveal" data-landing-reveal>
          <div className="landing-showcase-copy">
            <span>01 · NGHE &amp; NÓI</span>
            <h3>Nghe từng đoạn ngắn.<br />Bắt được từng âm thật.</h3>
            <p>Chép lại điều bạn nghe, nói theo giọng gốc và nhận phản hồi về những âm hoặc từ đang bị nuốt.</p>
            <ul><li>✓ Phụ đề chia thành câu luyện vừa sức</li><li>✓ IPA, trọng âm và nhịp nói trực quan</li><li>✓ Chấm nghe chép và phát âm tức thì</li></ul>
          </div>
          <div className="landing-demo landing-listen-demo" aria-label="Minh họa bài luyện nghe chép">
            <div className="demo-video"><span>LEARN ENGLISH WITH REAL STORIES</span><button aria-label="Phát video">▶</button><small>03:42 / 08:15</small></div>
            <div className="demo-wave"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
            <p>“Small steps become remarkable progress.”</p>
            <div className="demo-answer"><span>small steps become</span><b>remarkable</b><span>progress</span><i>92%</i></div>
          </div>
        </article>

        <article className="landing-showcase is-reverse landing-reveal" data-landing-reveal>
          <div className="landing-showcase-copy">
            <span>02 · VIẾT &amp; DỊCH</span>
            <h3>Biết chính xác mình sai đâu<br />và sửa như thế nào.</h3>
            <p>AI không chỉ cho điểm. Lexilo giải thích lỗi bằng tiếng Việt, đưa câu sửa tự nhiên và giữ đúng từ bạn đang luyện.</p>
            <ul><li>✓ So sánh từng cụm với câu diễn đạt mẫu</li><li>✓ Phân biệt lỗi ngữ pháp và cách nói khác</li><li>✓ Gợi ý từ nâng band vừa đủ, không lan man</li></ul>
          </div>
          <div className="landing-demo landing-writing-demo" aria-label="Minh họa phản hồi luyện dịch">
            <header><span>AI COACH</span><b>Phản hồi song ngữ</b><i>89/100</i></header>
            <div className="demo-prompt"><small>CÂU TIẾNG VIỆT</small><p>Mỗi buổi sáng tôi chạy quanh công viên để duy trì sức khỏe.</p></div>
            <div className="demo-correction"><small>BẢN DỊCH CỦA BẠN</small><p>Every morning I <del>run around park</del> <ins>run around the park</ins> to stay healthy.</p></div>
            <div className="demo-feedback"><i>✦</i><p><b>Gần đúng rồi!</b><span>Thêm “the” trước địa điểm cụ thể. Câu của bạn đã tự nhiên và đúng ý.</span></p></div>
          </div>
        </article>

        <article className="landing-showcase landing-reveal" data-landing-reveal>
          <div className="landing-showcase-copy">
            <span>03 · GHI NHỚ</span>
            <h3>Ôn đúng từ,<br />vào đúng thời điểm.</h3>
            <p>Lexilo ghi lại từng lần nhớ và quên để sắp lịch ôn, giúp bạn tập trung vào những từ thật sự cần thiết.</p>
            <ul><li>✓ Lịch Leitner thích nghi theo kết quả</li><li>✓ Biểu đồ phút luyện theo từng kỹ năng</li><li>✓ Chuỗi ngày học và mục tiêu mỗi tuần</li></ul>
          </div>
          <div className="landing-demo landing-progress-demo" aria-label="Minh họa tiến độ học tập">
            <header><span>TIẾN ĐỘ 7 NGÀY</span><b>Tuần này</b><i>+24%</i></header>
            <div className="demo-progress-bars">{[42, 68, 52, 81, 61, 94, 76].map((height, index) => <i key={index} style={{ "--bar-height": `${height}%`, "--landing-delay": `${index * 70}ms` } as CSSProperties} />)}</div>
            <div className="demo-progress-labels"><span>T2</span><span>T3</span><span>T4</span><span>T5</span><span>T6</span><span>T7</span><span>CN</span></div>
            <div className="demo-progress-stats"><div><small>ĐÃ THUỘC</small><b>96 từ</b></div><div><small>CẦN ÔN</small><b>12 từ</b></div><div><small>CHUỖI HỌC</small><b>7 ngày</b></div></div>
          </div>
        </article>
      </section>

      <section className="landing-section landing-journey">
        <header className="landing-section-head landing-reveal" data-landing-reveal>
          <span>MỘT VÒNG LẶP HIỆU QUẢ</span>
          <h2>Bốn bước nhỏ để<br /><em>biến từ mới thành phản xạ</em></h2>
        </header>
        <div className="landing-journey-grid landing-reveal" data-landing-reveal>
          <article><i>01</i><span>Hiểu</span><p>Nghĩa, phát âm và từ nâng band được trình bày gọn.</p></article>
          <article><i>02</i><span>Gặp</span><p>Thấy từ trong câu, video và tình huống thực tế.</p></article>
          <article><i>03</i><span>Dùng</span><p>Tự nói, viết hoặc dịch bằng chính từ vừa học.</p></article>
          <article><i>04</i><span>Ôn</span><p>Quay lại đúng lúc trước khi trí nhớ bắt đầu phai.</p></article>
        </div>
      </section>

      <section className="landing-section landing-ecosystem" id="ecosystem">
        <header className="landing-section-head landing-reveal" data-landing-reveal>
          <span>HỌC Ở BẤT KỲ ĐÂU</span>
          <h2>Một tài khoản.<br /><em>Hai cách đưa tiếng Anh vào đời sống.</em></h2>
          <p>Học tập trung trong ứng dụng web, rồi tiếp tục tra và lưu từ ngay khi bạn đọc nội dung trên trình duyệt.</p>
        </header>
        <div className="landing-product-pair landing-reveal" data-landing-reveal>
          <article>
            <div className="product-pair-icon">L</div><small>ỨNG DỤNG WEB</small><h3>Luyện tập &amp; thành thạo</h3><p>Video, nghe chép, nói nhại, luyện dịch và hệ thống ôn từ trong một không gian tập trung.</p>
            <ul><li>✓ 7 chế độ luyện tập</li><li>✓ Kho từ và tiến độ đồng bộ</li><li>✓ AI sửa bài song ngữ</li></ul>
          </article>
          <div className="landing-sync"><i>↔</i><span>Đồng bộ tự động</span></div>
          <article className="is-extension">
            <div className="product-pair-icon">✦</div><small>TIỆN ÍCH TRÌNH DUYỆT</small><h3>Học ngay khi đang đọc</h3><p>Tra nghĩa theo ngữ cảnh, phát âm và lưu từ mới mà không phải rời khỏi trang bạn đang xem.</p>
            <ul><li>✓ Tra từ ngay trên trang web</li><li>✓ Lưu thẳng về kho Lexilo</li><li>✓ Học tiếp trên mọi thiết bị</li></ul>
          </article>
        </div>
      </section>

      <section className="landing-section landing-faq" id="faq">
        <header className="landing-section-head landing-reveal" data-landing-reveal>
          <span>CÂU HỎI THƯỜNG GẶP</span>
          <h2>Trước khi bắt đầu,<br /><em>có thể bạn muốn biết</em></h2>
        </header>
        <div className="landing-faq-list landing-reveal" data-landing-reveal>
          {faqs.map(([question, answer], index) => (
            <details key={question} open={index === 0}><summary>{question}<i>+</i></summary><p>{answer}</p></details>
          ))}
        </div>
      </section>

      <section className="landing-final-cta landing-reveal" data-landing-reveal>
        <div><span>✦ BẮT ĐẦU TỪ HÔM NAY</span><h2>Biến vốn từ bạn đã học<br />thành tiếng Anh bạn dùng được.</h2><p>Tạo tài khoản miễn phí và bắt đầu với một phiên luyện ngắn ngay bây giờ.</p></div>
        <button className="landing-primary" disabled={loading} onClick={openSignUp}>{loading ? "Đang kiểm tra phiên…" : "Học miễn phí ngay →"}</button>
      </section>

      <footer className="landing-footer">
        <a className="landing-brand" href="#top" aria-label="Lexilo — Về đầu trang"><span>L</span><b>Lexilo</b></a>
        <p>Học từ có ngữ cảnh. Luyện để dùng được.</p>
        <div><a href="#method">Phương pháp</a><a href="#features">Luyện tập</a><a href="#faq">FAQ</a></div>
      </footer>
    </main>
  );
}
