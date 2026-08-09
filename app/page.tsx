"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Rating = "again" | "hard" | "good" | "easy";
type WordCard = {
  id: string;
  term: string;
  ipa: string;
  meaning: string;
  example: string;
  cloze: string;
  definition: string;
  topic: string;
  box: number;
  lapses: number;
  starred?: boolean;
};

const initialWords: WordCard[] = [
  { id: "1", term: "resilient", ipa: "/rɪˈzɪliənt/", meaning: "kiên cường, nhanh chóng hồi phục", example: "She remained resilient despite several difficult setbacks.", cloze: "She remained _____ despite several difficult setbacks.", definition: "Able to recover quickly from difficulties.", topic: "Cảm xúc", box: 2, lapses: 5, starred: true },
  { id: "2", term: "take for granted", ipa: "/teɪk fər ˈɡrɑːntɪd/", meaning: "coi là điều hiển nhiên", example: "We often take clean water for granted.", cloze: "We often _____ clean water _____.", definition: "To fail to properly appreciate someone or something.", topic: "Đời sống", box: 3, lapses: 4, starred: true },
  { id: "3", term: "deploy", ipa: "/dɪˈplɔɪ/", meaning: "triển khai", example: "The team will deploy the update after lunch.", cloze: "The team will _____ the update after lunch.", definition: "To put something into effective action.", topic: "Công nghệ", box: 4, lapses: 2 },
  { id: "4", term: "subtle", ipa: "/ˈsʌtl/", meaning: "tinh tế; khó nhận thấy", example: "There was a subtle change in her voice.", cloze: "There was a _____ change in her voice.", definition: "Not obvious and therefore difficult to notice.", topic: "Giao tiếp", box: 2, lapses: 3 },
  { id: "5", term: "retrieve", ipa: "/rɪˈtriːv/", meaning: "lấy lại; truy xuất", example: "The service can retrieve cached data instantly.", cloze: "The service can _____ cached data instantly.", definition: "To find and bring back something.", topic: "Công nghệ", box: 1, lapses: 6, starred: true },
];

const weekDays = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const heat = [0,1,2,0,3,1,0, 2,3,1,4,2,0,1, 1,2,4,3,1,2,0, 3,4,2,1,3,4,1, 2,1,3,4,2,3,0, 4,3,2,4,3,1,2, 1,2,3,2,4,3,1, 3,4,4,2,3,1,0, 2,3,1,4,4,2,1, 4,3,2,3,4,1,2, 2,4,3,4,2,3,1, 3,4,2,4,3,2,1];

export default function Home() {
  const [tab, setTab] = useState<"home" | "words">("home");
  const [reviewing, setReviewing] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [index, setIndex] = useState(0);
  const [words, setWords] = useState(initialWords);
  const [showAdd, setShowAdd] = useState(false);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const startedAt = useRef(Date.now());
  const card = words[index % words.length];

  const filtered = useMemo(() => words.filter((word) => `${word.term} ${word.meaning} ${word.topic}`.toLowerCase().includes(query.toLowerCase())), [words, query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setShowAdd(true); }
      if (!reviewing || (event.target as HTMLElement)?.tagName === "INPUT") return;
      if (event.code === "Space") { event.preventDefault(); setRevealed(true); }
      if (revealed && ["1", "2", "3", "4"].includes(event.key)) rate(({1:"again",2:"hard",3:"good",4:"easy"} as Record<string, Rating>)[event.key]);
      if (event.key.toLowerCase() === "s") toggleStar(card.id);
      if (event.key === "Escape") setReviewing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function startReview() { setReviewing(true); setIndex(0); setRevealed(false); setAnswer(""); startedAt.current = Date.now(); }
  function rate(rating: Rating) {
    setWords((current) => current.map((word) => word.id !== card.id ? word : { ...word, box: rating === "again" ? 1 : Math.min(6, word.box + (rating === "easy" ? 2 : rating === "good" ? 1 : 0)), lapses: rating === "again" ? word.lapses + 1 : word.lapses }));
    setIndex((value) => value + 1); setRevealed(false); setAnswer(""); startedAt.current = Date.now();
  }
  function toggleStar(id: string) { setWords((current) => current.map((word) => word.id === id ? { ...word, starred: !word.starred } : word)); }
  function speak(term: string) { window.speechSynthesis?.speak(new SpeechSynthesisUtterance(term)); }

  if (reviewing) return <ReviewView card={card} index={index} total={words.length} revealed={revealed} answer={answer} setAnswer={setAnswer} reveal={() => setRevealed(true)} rate={rate} close={() => setReviewing(false)} speak={speak} toggleStar={() => toggleStar(card.id)} />;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">L</span><span>Lexilo</span></div>
        <nav aria-label="Điều hướng chính">
          <button className={tab === "home" ? "nav-item active" : "nav-item"} onClick={() => setTab("home")}><span>⌂</span> Hôm nay</button>
          <button className={tab === "words" ? "nav-item active" : "nav-item"} onClick={() => setTab("words")}><span>▤</span> Từ vựng</button>
          <button className="nav-item"><span>◇</span> Luyện tập</button>
          <button className="nav-item"><span>⌁</span> Thống kê</button>
        </nav>
        <div className="sidebar-bottom">
          <button className="quick-add" onClick={() => setShowAdd(true)}>＋ Thêm từ mới <kbd>⌘ K</kbd></button>
          <button className="profile"><span className="avatar">RY</span><span><b>Ryan</b><small>Học đều mỗi ngày</small></span><span>•••</span></button>
        </div>
      </aside>

      <section className="content">
        <header className="mobile-head"><div className="brand"><span className="brand-mark">L</span><span>Lexilo</span></div><button onClick={() => setShowAdd(true)} aria-label="Thêm từ">＋</button></header>
        {tab === "home" ? <Dashboard words={words} startReview={startReview} openWords={() => setTab("words")} /> : <Words words={filtered} query={query} setQuery={setQuery} toggleStar={toggleStar} add={() => setShowAdd(true)} />}
      </section>

      <nav className="mobile-nav" aria-label="Điều hướng di động">
        <button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}><span>⌂</span>Hôm nay</button>
        <button className={tab === "words" ? "active" : ""} onClick={() => setTab("words")}><span>▤</span>Từ vựng</button>
        <button><span>◇</span>Luyện tập</button><button><span>⌁</span>Thống kê</button>
      </nav>
      {showAdd && <AddWord close={() => setShowAdd(false)} save={(word) => { setWords((current) => [{ ...word, id: crypto.randomUUID(), box: 1, lapses: 0 }, ...current]); setShowAdd(false); }} />}
    </main>
  );
}

function Dashboard({ words, startReview, openWords }: { words: WordCard[]; startReview: () => void; openWords: () => void }) {
  return <div className="page dashboard">
    <div className="eyebrow">CHỦ NHẬT, 09 THÁNG 8</div>
    <div className="greeting"><div><h1>Chào buổi sáng, Ryan <span>✦</span></h1><p>Một phiên ôn ngắn hôm nay sẽ giúp trí nhớ đi xa hơn.</p></div><button className="icon-button" aria-label="Thông báo">♢<i /></button></div>
    <section className="hero-card">
      <div className="hero-copy"><div className="today-icon">◎</div><div><span>SẴN SÀNG CHO HÔM NAY</span><h2><strong>24</strong> từ đang chờ bạn ôn tập</h2><p>15 từ đến hạn · 9 từ mới</p></div></div>
      <button className="primary" onClick={startReview}>Bắt đầu học <span>→</span></button>
    </section>
    <div className="stats-grid">
      <Stat label="Tổng số từ" value="486" note="↑ 18 từ tháng này" icon="▤" tone="purple" />
      <Stat label="Đang học" value="127" note="26% tổng số từ" icon="◔" tone="orange" />
      <Stat label="Đã thuộc" value="359" note="74% tổng số từ" icon="✓" tone="green" />
      <Stat label="Chuỗi ngày" value="12 ngày" note="Kỷ lục: 18 ngày" icon="♨" tone="pink" />
    </div>
    <div className="dashboard-grid">
      <section className="panel heatmap-panel"><div className="panel-title"><div><h3>Nhịp học của bạn</h3><p>12 tuần gần nhất</p></div><div className="legend">Ít <i className="h0"/><i className="h1"/><i className="h2"/><i className="h3"/><i className="h4"/> Nhiều</div></div><div className="heatmap"><div className="days">{weekDays.map((d) => <span key={d}>{d}</span>)}</div><div className="heat-cells">{heat.map((v,i) => <i className={`h${v}`} key={i} title={`${v * 8} từ đã ôn`} />)}</div></div><div className="heat-footer"><span><b>178</b> từ đã ôn tuần này</span><span>↑ 23% so với tuần trước</span></div></section>
      <section className="panel tough"><div className="panel-title"><div><h3>Từ cần chú ý</h3><p>Những từ bạn hay quên nhất</p></div><button onClick={openWords}>Xem tất cả →</button></div>{words.slice().sort((a,b) => b.lapses-a.lapses).slice(0,4).map((w) => <div className="tough-row" key={w.id}><span className="word-dot">{w.term[0].toUpperCase()}</span><span><b>{w.term}</b><small>{w.meaning}</small></span><span className="lapse">{w.lapses} lần quên</span><button aria-label={`Ôn từ ${w.term}`}>→</button></div>)}</section>
    </div>
    <div className="tip"><span>♢</span><p><b>Mẹo nhỏ hôm nay</b><br/>Đặt một câu thật về chính bạn với từ mới — ký ức gắn với trải nghiệm cá nhân sẽ bền hơn.</p><button aria-label="Ẩn mẹo">×</button></div>
  </div>;
}

function Stat({ label, value, note, icon, tone }: { label:string; value:string; note:string; icon:string; tone:string }) { return <div className="stat"><div className={`stat-icon ${tone}`}>{icon}</div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>; }

function Words({ words, query, setQuery, toggleStar, add }: { words:WordCard[]; query:string; setQuery:(s:string)=>void; toggleStar:(id:string)=>void; add:()=>void }) {
  return <div className="page words-page"><div className="section-head"><div><div className="eyebrow">THƯ VIỆN CỦA BẠN</div><h1>Từ vựng</h1><p>Tìm kiếm, sắp xếp và theo dõi tiến độ từng từ.</p></div><button className="primary" onClick={add}>＋ Thêm từ mới</button></div><div className="word-tools"><label><span>⌕</span><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Tìm từ, nghĩa hoặc chủ đề..." /></label><button>Trạng thái⌄</button><button>Chủ đề⌄</button><button>Thiếu ví dụ</button></div><div className="word-table"><div className="word-tr word-th"><span>TỪ VỰNG</span><span>CHỦ ĐỀ</span><span>TIẾN ĐỘ</span><span>TRẠNG THÁI</span><span /></div>{words.map((w)=><div className="word-tr" key={w.id}><span className="word-main"><button onClick={()=>toggleStar(w.id)} aria-label="Gắn sao">{w.starred?"★":"☆"}</button><span><b>{w.term}</b><small>{w.ipa} · {w.meaning}</small></span></span><span><em>{w.topic}</em></span><span className="box-dots">{[1,2,3,4,5,6].map(n=><i className={n<=w.box?"filled":""} key={n}/>)}</span><span><i className="status-dot"/>Đang học</span><button aria-label="Tùy chọn">•••</button></div>)}</div></div>;
}

function ReviewView({ card, index, total, revealed, answer, setAnswer, reveal, rate, close, speak, toggleStar }: { card:WordCard; index:number; total:number; revealed:boolean; answer:string; setAnswer:(s:string)=>void; reveal:()=>void; rate:(r:Rating)=>void; close:()=>void; speak:(s:string)=>void; toggleStar:()=>void }) {
  return <main className="review"><header><button onClick={close} aria-label="Thoát phiên học">×</button><div><div className="review-count"><span>{Math.min(index+1,total)} / {total}</span><span>{Math.round(((index+1)/total)*100)}%</span></div><div className="progress"><i style={{width:`${((index+1)/total)*100}%`}}/></div></div><button onClick={toggleStar} aria-label="Gắn sao">{card.starred?"★":"☆"}</button></header><section className={`flashcard ${revealed?"revealed":""}`}>{!revealed ? <><span className="card-label">VIỆT → ANH</span><h1>{card.meaning}</h1><p className="cloze">{card.cloze}</p><label className="answer"><input autoFocus value={answer} onChange={(e)=>setAnswer(e.target.value)} onKeyDown={(e)=>{if(e.key==="Enter")reveal();}} placeholder="Nhập từ tiếng Anh..."/><span>↵</span></label><small>Tự nhớ trong đầu hoặc nhập đáp án</small></> : <><span className="card-label">ĐÁP ÁN</span><div className="term-line"><h1>{card.term}</h1><button onClick={()=>speak(card.term)} aria-label={`Phát âm ${card.term}`}>◖))</button></div><div className="ipa">{card.ipa}</div><p className="example">{card.example}</p><p className="definition">{card.definition}</p></>}</section>{!revealed ? <button className="reveal" onClick={reveal}>Hiện đáp án <kbd>Space</kbd></button> : <div className="ratings"><button onClick={()=>rate("again")}><b>😵 Quên</b><small>1 ngày</small><kbd>1</kbd></button><button onClick={()=>rate("hard")}><b>😐 Khó</b><small>2 ngày</small><kbd>2</kbd></button><button onClick={()=>rate("good")}><b>🙂 Được</b><small>7 ngày</small><kbd>3</kbd></button><button onClick={()=>rate("easy")}><b>😎 Dễ</b><small>14 ngày</small><kbd>4</kbd></button></div>}<footer>Phím tắt: <kbd>Space</kbd> lật thẻ · <kbd>1–4</kbd> đánh giá · <kbd>S</kbd> gắn sao · <kbd>Esc</kbd> thoát</footer></main>;
}

function AddWord({ close, save }: { close:()=>void; save:(w:Omit<WordCard,"id"|"box"|"lapses">)=>void }) {
  const [term,setTerm]=useState(""); const [meaning,setMeaning]=useState(""); const [example,setExample]=useState(""); const [topic,setTopic]=useState("Đời sống");
  function submit(e:FormEvent){e.preventDefault(); if(!term||!meaning)return; save({term,meaning,example:example||`I am learning how to use ${term} naturally.`,cloze:(example||`I am learning how to use ${term} naturally.`).replace(new RegExp(term,"i"),"_____"),ipa:"/…/",definition:"Bổ sung định nghĩa Anh–Anh sau.",topic});}
  return <div className="modal-backdrop" onMouseDown={close}><form className="modal" onMouseDown={(e)=>e.stopPropagation()} onSubmit={submit}><div className="modal-head"><div><span className="eyebrow">THÊM NHANH</span><h2>Từ mới của bạn</h2></div><button type="button" onClick={close}>×</button></div><label>Từ hoặc cụm từ tiếng Anh<input autoFocus value={term} onChange={(e)=>setTerm(e.target.value)} placeholder="Ví dụ: meaningful" /></label><button className="ai-fill" type="button" onClick={()=>{if(term){setMeaning("có ý nghĩa, đáng giá");setExample(`This small habit makes each day more ${term}.`);}}}>✦ Tự động điền bằng AI</button><div className="form-grid"><label>Nghĩa tiếng Việt<input value={meaning} onChange={(e)=>setMeaning(e.target.value)} placeholder="Nhập nghĩa..." /></label><label>Chủ đề<select value={topic} onChange={(e)=>setTopic(e.target.value)}><option>Đời sống</option><option>Công nghệ</option><option>Cảm xúc</option><option>Giao tiếp</option></select></label></div><label>Câu ví dụ<textarea value={example} onChange={(e)=>setExample(e.target.value)} placeholder="Một câu 8–15 từ trong ngữ cảnh tự nhiên" /></label><div className="modal-actions"><button type="button" onClick={close}>Hủy</button><button className="primary" type="submit">Lưu từ mới</button></div></form></div>;
}
