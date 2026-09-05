import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the public Lexilo landing page before authentication", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Lexilo — Học từ vựng thông minh<\/title>/i);
  assert.match(html, /Điều hướng trang giới thiệu/);
  assert.match(html, /Học tiếng Anh/);
  assert.match(html, /Đăng ký miễn phí/);
  assert.doesNotMatch(html, /Điều hướng chính/);
});

test("gates the learning workspace behind a Supabase session", async () => {
  const [page, landing, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/LandingPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/extras.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /if \(!userId\) \{[\s\S]*<LandingPage/);
  assert.match(page, /openSignIn=\{\(\) => openAuth\("signin"\)\}/);
  assert.match(page, /openSignUp=\{\(\) => openAuth\("signup"\)\}/);
  assert.match(landing, /Đăng ký miễn phí/);
  assert.match(landing, /AI sửa lỗi rõ ràng/);
  assert.match(landing, /PHƯƠNG PHÁP LEXILO/);
  assert.match(landing, /LUYỆN ĐỦ BỐN KỸ NĂNG/);
  assert.match(landing, /HỌC Ở BẤT KỲ ĐÂU/);
  assert.match(landing, /CÂU HỎI THƯỜNG GẶP/);
  assert.match(landing, /IntersectionObserver/);
  assert.match(landing, /--landing-tilt-x/);
  assert.match(styles, /@keyframes landing-orb-one/);
  assert.match(styles, /\.landing-compare/);
  assert.match(styles, /\.landing-showcase/);
  assert.match(styles, /\.landing-faq/);
  assert.match(styles, /--font-ui:Quicksand/);
  assert.match(styles, /--type-page-title/);
  assert.match(styles, /font-family:var\(--font-ui\)!important/);
  assert.match(styles, /@media\(prefers-reduced-motion:reduce\)/);
});

// Ba khối này từng nằm chung ở màn Tiến độ, khiến màn đó vừa rối vừa lẫn hai
// loại nội dung: VIỆC phải làm hôm nay và SỐ ĐO đã làm được. Nay mỗi khối về
// đúng màn của nó. Test khoá lại thế đứng mới để không ai gộp ngược trở lại.
test("mỗi khối nằm đúng màn: việc ở Trang chủ, số đo ở Tiến độ, chọn nhóm ở Từ vựng", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const slice = (from, to) => page.slice(page.indexOf(from), page.indexOf(to, page.indexOf(from)));

  // Tiến độ chỉ còn số đo — và chỉ MỘT khối Leitner, không phải hai như trước.
  const progress = slice("function Stats(", "function BulkAddWords");
  assert.match(progress, /<WeeklyTracker/);
  assert.doesNotMatch(progress, /<LearningPlan/);
  assert.doesNotMatch(progress, /<DailyStudy/);
  assert.doesNotMatch(progress, /Phân bố theo hộp Leitner/);

  // Kế hoạch hôm nay và lời nhắc đến hạn thuộc về Trang chủ.
  const home = slice("function Dashboard(", "function LearningPlan(");
  assert.match(home, /<LearningPlan/);
  assert.match(home, /className="due-reminder"/);

  // Bộ chọn nhóm từ là cách BẮT ĐẦU một phiên từ vựng, nên ở trong kỹ năng đó.
  assert.match(page, /extra=\{skillHub === "vocab" \? <DailyStudy/);

  // Khối Leitner duy nhất giờ nằm trong WeeklyTracker, kèm biểu đồ theo hộp.
  const leitner = slice("function WeeklyTracker(", "// Rê chuột vào một từ");
  assert.match(leitner, /Phân bố theo hộp Leitner/);
  assert.match(leitner, /className="bar-chart"/);
});

test("keeps personal vocabulary and the PDF collection separated", async () => {
  const [page, vocabulary, types] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/vocabulary-1000.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/types.ts", import.meta.url), "utf8"),
  ]);
  const items = JSON.parse(vocabulary);
  assert.equal(items.length, 983);
  // Vị từ này đã chuyển sang lib/types.ts; giao diện chỉ import và dùng.
  assert.match(types, /export function isPdfVocabulary/);
  assert.match(page, /isPdfVocabulary/);
  assert.match(page, /const cards: ShelfCard\[]/);
  assert.match(page, /Học folder này/);
  // Điều cần giữ là Practice nhận TOÀN BỘ words, không phải danh sách đã lọc bỏ bộ
  // PDF. Cho phép có thêm prop khác đứng trước (key, intent…) — khớp cứng cả thứ tự
  // prop thì thêm một prop là test đỏ dù ý nghĩa không đổi.
  assert.match(page, /<Practice[^>]*\swords=\{words\}/);
  assert.match(page, /words\.filter\(\(word\) => !isPdfVocabulary\(word\)\)/);
});

test("lets the owner clear an optional weekday in the vocabulary picker", async () => {
  const [picker, page, styles] = await Promise.all([
    readFile(new URL("../components/WordListPicker.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/extras.css", import.meta.url), "utf8"),
  ]);
  assert.match(picker, /studyDay = null/);
  assert.match(picker, /studyDay === index \? null : index/);
  assert.match(picker, /aria-pressed=\{collection === "mine" && studyDay === index\}/);
  assert.doesNotMatch(picker, /role="radio"/);
  assert.match(picker, /Đã lưu vào danh sách/);
  assert.match(picker, /Tự động lưu ngay khi tích chọn/);
  assert.match(picker, /onDone && <button type="button" onClick=\{onDone\}>Xong<\/button>/);
  assert.match(page, /study_day: safeDay \?\? null/);
  assert.match(styles, /lesson-lookup-lists\{max-height:min\(520px,60vh\);overflow-y:auto;overflow-x:hidden\}/);
});

test("keeps weekday scheduling separate from user-selected vocabulary folders", async () => {
  const [page, picker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/WordListPicker.tsx", import.meta.url), "utf8"),
  ]);
  const addWord = page.slice(page.indexOf("function AddWord"));
  assert.match(addWord, /Ngày học/);
  assert.match(addWord, /!legacyCollections && <WordListPicker/);
  assert.match(addWord, /selectedFolderIds=\{folderIds\}/);
  assert.match(addWord, /onSelectedFolderIdsChange=\{setFolderIds\}/);
  assert.match(page, /save=\{\(word, folderIds\) =>/);
  assert.match(page, /addWords\(current, folderId, \[created\.id\]\)/);
  assert.match(picker, /Lưu vào danh sách/);
  assert.match(picker, /Không bắt buộc · có thể chọn nhiều danh sách/);
  assert.match(picker, /Tạo và chọn/);
  assert.doesNotMatch(picker, /<form onSubmit/);
});

test("renders one folder detail panel instead of duplicating the list", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.equal((page.match(/Danh sách này chưa có từ nào/g) ?? []).length, 1);
  assert.equal((page.match(/aria-label="Đường dẫn kho từ vựng"/g) ?? []).length, 1);
  assert.doesNotMatch(page, /aria-label="Đường dẫn danh sách từ"/);
});

test("duplicate-word validation does not reference the lookup-only variable", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const start = page.lastIndexOf("function submit(e: FormEvent)");
  const end = page.indexOf("  return (", start);
  const submitBody = page.slice(start, end);
  assert.doesNotMatch(submitBody, /\bword\.toLowerCase\(\)/);
  assert.match(submitBody, /if \(duplicate\)/);
});

test("imports the seven weekday workbooks without sheet topics or duplicate terms", async () => {
  const raw = await readFile(new URL("../public/weekly-vocabulary.json", import.meta.url), "utf8");
  const words = JSON.parse(raw);
  assert.equal(words.length, 174);
  assert.deepEqual(
    Array.from({ length: 7 }, (_, studyDay) => words.filter((word) => word.studyDay === studyDay).length),
    [17, 22, 41, 28, 25, 22, 19],
  );
  assert.deepEqual([...new Set(words.map((word) => word.topic))], ["Từ vựng chung"]);
  const normalizedTerms = words.map((word) => word.term.trim().toLowerCase().replace(/\s+/g, " "));
  assert.equal(new Set(normalizedTerms).size, normalizedTerms.length);
  assert.deepEqual(
    [...new Set(words.map((word) => word.source))],
    ["01 Monday.xlsx", "02 Tuesday.xlsx", "03 Wednesday.xlsx", "04 Thursday.xlsx", "05 Friday.xlsx", "06 Saturday.xlsx", "07 Sunday.xlsx"],
  );
});

test("supports pasting a daily vocabulary list with preview and duplicate filtering", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /function BulkAddWords/);
  assert.match(page, /Dán danh sách từ/);
  assert.match(page, /normalizedExisting\.has\(normalized\) \|\| seen\.has\(normalized\)/);
  assert.match(page, /shopping cart \/ trolley/);
  assert.match(page, /studyDay/);
});

test("keeps word and dictionary-sense suggestions optional when adding vocabulary", async () => {
  const [page, redesign] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/workspace-redesign.css", import.meta.url), "utf8"),
  ]);
  const addWord = page.slice(page.indexOf("function AddWord"));

  assert.match(addWord, /Gợi ý từ[\s\S]*Không bắt buộc/);
  assert.match(addWord, /Giữ “\{term\.trim\(\)\}” và tiếp tục nhập/);
  assert.match(addWord, /Gợi ý \{senses\.length\} nghĩa từ từ điển/);
  assert.match(addWord, /Không bắt buộc chọn — bạn có thể nhập nghĩa riêng/);
  assert.match(addWord, /disabled=\{!!duplicate \|\| !term\.trim\(\)\}/);
  assert.doesNotMatch(addWord.slice(addWord.indexOf("function submit"), addWord.indexOf("return (")), /Mỗi từ cần có cụm đi cùng/);
  assert.match(redesign, /\.term-suggest-skip/);
});

test("keeps the add-word layout stable when a lookup returns many senses", async () => {
  const [page, redesign] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/workspace-redesign.css", import.meta.url), "utf8"),
  ]);
  const addWord = page.slice(page.indexOf("function AddWord"));
  assert.match(addWord, /<details className="sense-picker">/);
  assert.match(addWord, /Mở để đổi nghĩa/);
  assert.match(addWord, /className="field-wide"[\s\S]*Nghĩa tiếng Việt/);
  assert.match(addWord, /Thông tin cơ bản/);
  assert.match(addWord, /Cách dùng/);
  assert.match(redesign, /\.full-screen-form>\.form-screen \.modal-actions\{position:static/);
  assert.match(redesign, /\.add-word-basics \.field-wide\{grid-column:1\/-1\}/);
});

test("studies every word when a folder is selected", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const start = page.indexOf("function buildCollectionQueue");
  const end = page.indexOf("function LearningPlan", start);
  const queueBuilder = page.slice(start, end);
  assert.doesNotMatch(queueBuilder, /\.slice\(/);
  assert.doesNotMatch(queueBuilder, /mastered/);
  assert.match(page, /học toàn bộ trong một phiên/);
});

test("fills Vietnamese meanings for words pasted as a list", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /meaning_vi\?: string/);
  assert.match(page, /meaning: keepText\(word\.meaning, data\.meaning_vi/);
  assert.match(page, /meaning_vi: enriched\.meaning/);
  assert.match(page, /word\.meaning === "Chưa bổ sung nghĩa"/);
});

test("keeps enrichment results when cloud sync fails and accepts slash alternatives", async () => {
  const [page, route] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/enrich/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /fallbackSaveError/);
  assert.doesNotMatch(page.slice(page.indexOf("if (saveError)"), page.indexOf("function resumeSession")), /throw saveError/);
  assert.match(route, /word\.split\("\/"\)\[0\]/);
  assert.match(route, /gạch nối và dấu \//);
});

test("provides unique contextual examples for every weekday vocabulary item", async () => {
  const [vocabularyRaw, examplesRaw, page] = await Promise.all([
    readFile(new URL("../public/weekly-vocabulary.json", import.meta.url), "utf8"),
    readFile(new URL("../public/weekly-examples.json", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  const vocabulary = JSON.parse(vocabularyRaw);
  const examples = JSON.parse(examplesRaw);
  assert.equal(Object.keys(examples).length, vocabulary.length);
  assert.equal(new Set(Object.values(examples).map(([english]) => english.toLowerCase())).size, vocabulary.length);
  for (const word of vocabulary) {
    const pair = examples[word.term.trim().toLowerCase()];
    assert.ok(pair?.[0]?.trim(), `Missing English example for ${word.term}`);
    assert.ok(pair?.[1]?.trim(), `Missing Vietnamese example for ${word.term}`);
    assert.doesNotMatch(pair[0], /I am learning how to use|The report uses|Our teacher explained|The article shows how|We discussed/);
  }
  assert.match(page, /fetch\("\/weekly-examples\.json"\)/);
  assert.match(page, /example: word\.example, exampleVi: word\.exampleVi, cloze: word\.cloze/);
});

test("paginates large vocabulary folders without limiting study queues", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const PAGE_SIZE = 25/);
  assert.match(page, /const pagedVisible = visible\.slice/);
  assert.match(page, /aria-label="Phân trang từ vựng"/);
  assert.match(page, /Hiển thị \{/);
  const queueStart = page.indexOf("function buildCollectionQueue");
  const queueEnd = page.indexOf("function LearningPlan", queueStart);
  assert.doesNotMatch(page.slice(queueStart, queueEnd), /PAGE_SIZE|\.slice\(/);
});

test("prioritizes band upgrades and keeps secondary vocabulary compact", async () => {
  const [page, dictionary, route, schema] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/Dictionary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/enrich/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
  ]);
  assert.match(route, /async function usageDetails/);
  assert.match(route, /synonym_details:synonymDetails/);
  assert.match(route, /antonym_details:antonymDetails/);
  assert.match(route, /related_details:relatedDetails/);
  assert.match(page, /item\.meaningVi/);
  assert.match(page, /item\.exampleVi/);
  assert.match(page, /const useUpgrades = upgrades\.length > 0/);
  assert.match(page, /04 · Nâng band/);
  assert.match(dictionary, /upgrades\.length === 0/);
  const detail = page.slice(page.indexOf("function WordDetail"), page.indexOf("function Celebration"));
  assert.doesNotMatch(detail, /Từ hay đi cùng chủ đề|word\.related/);
  assert.match(schema, /synonym_details jsonb/);
});

test("provides complete email authentication and account recovery flows", async () => {
  const [modal, page] = await Promise.all([
    readFile(new URL("../components/AuthModal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(modal, /signInWithPassword/);
  assert.match(modal, /signUp\([\s\S]*full_name: cleanName/);
  assert.match(modal, /signInWithOtp[\s\S]*shouldCreateUser: false/);
  assert.match(modal, /resetPasswordForEmail/);
  assert.match(modal, /auth\.resend\(\{ type: "signup"/);
  assert.match(modal, /showAccount = Boolean\(signedIn \|\| signedInEmail\) && mode !== "recovery"/);
  assert.match(modal, /auth-showcase/);
  assert.match(modal, /auth-form-panel/);
  assert.match(modal, /Đồng bộ tiến độ học/);
  assert.match(modal, /updateUser\(\{ data: \{ full_name: cleanName, name: cleanName \} \}\)/);
  assert.match(modal, /Tên hiển thị/);
  assert.match(page, /freshSignIn[\s\S]*window\.location\.reload\(\)/);
  assert.match(page, /signedInName=\{userName\}/);
  assert.match(page, /signedIn=\{Boolean\(userId\)\}/);
  assert.match(page, /syncStatus=\{cloudStatus\}/);
  assert.match(page, /userId \? userName : "Đăng nhập"/);
});

test("keeps the selected translation example layout throughout the session", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const translateStart = page.indexOf("function TranslateMode");
  const translateEnd = page.indexOf("function FlipCard", translateStart);
  const translate = page.slice(translateStart, translateEnd);

  assert.match(translate, /mode: terms\.length < 2 \? "sentences" : extraMode/);
  assert.match(translate, /extraMode === "sentences" && current \? \[current\] : tasks/);
  assert.match(translate, /"ĐOẠN VĂN LIỀN MẠCH" : "TỪNG CÂU RIÊNG"/);
  assert.match(translate, /if \(checked\) \{[\s\S]*setChecked\(false\);[\s\S]*setAiGrade\(null\);[\s\S]*setScores\(\(list\) => list\.slice\(0, -1\)\)/);
  assert.match(translate, /<section className="reference-fold">[\s\S]*Đối chiếu từng từ với một cách dịch mẫu/);
  assert.doesNotMatch(translate, /<details className="reference-fold">/);
  assert.doesNotMatch(translate, /mode: terms\.length < 2 \? "sentences" : "passage"/);
});

test("keeps vocabulary hover cards inside the viewport layer", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const glanceStart = page.indexOf("function EnglishText");
  const glanceEnd = page.indexOf("function FolderPicker", glanceStart);
  const glance = page.slice(glanceStart, glanceEnd);

  assert.match(glance, /Math\.min\(box\.left, window\.innerWidth - width - 12\)/);
  assert.match(glance, /createPortal\([\s\S]*document\.body/);
});

test("falls back to a second dictionary when adding a common new word", async () => {
  const route = await readFile(new URL("../app/api/ai/enrich/route.ts", import.meta.url), "utf8");
  assert.match(route, /async function lookupDatamuseEntry/);
  assert.match(route, /return lookupDatamuseEntry\(word\)/);
  assert.match(route, /sp=\$\{encodeURIComponent\(word\)\}&md=dpr/);
});

test("keeps the learning workspace usable across mobile breakpoints", async () => {
  const [page, styles, redesign] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/extras.css", import.meta.url), "utf8"),
    readFile(new URL("../app/workspace-redesign.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /\{!reviewing && <nav className="mobile-nav"/);
  assert.match(page, /openDictionaryPage[\s\S]*Từ điển/);
  assert.match(styles, /\.mobile-nav\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(redesign, /\.lexilo-workspace \.review-modes \{[\s\S]*grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.word-tools select,\.word-tools>button\{display:flex/);
  assert.match(styles, /\.word-table \.word-tr:not\(\.word-th\)\{position:relative;display:grid/);
  assert.match(styles, /\.lesson-lookup-popover\{position:fixed/);
});

test("uses the rebuilt responsive workspace shell without changing learning data flows", async () => {
  const [layout, page, library, redesign] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/LessonLibrary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/workspace-redesign.css", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /import "\.\/workspace-redesign\.css"/);
  assert.match(page, /className="app-shell lexilo-workspace"/);
  assert.match(page, /data-section=\{tab\}/);
  assert.match(page, /data-practice=\{practiceIntent \?\? undefined\}/);
  assert.match(page, /className="skip-link" href="#workspace-content"/);
  assert.match(page, /className="workspace-topbar"/);
  assert.match(page, /className="practice-empty-state"/);
  assert.match(page, /Tra và lưu từ/);
  assert.match(redesign, /--ui-sidebar-width:264px/);
  assert.match(redesign, /@media\(max-width:900px\)/);
  assert.match(redesign, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(redesign, /\.full-screen-form>\.form-screen\{width:100%;max-width:none;min-height:100dvh/);
  assert.match(redesign, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(redesign, /--ui-bg:var\(--bg\)/);
  assert.match(redesign, /--section-accent:var\(--ui-accent\)/);
  assert.match(redesign, /--tone-1:hsl\(var\(--hue\)/);
  assert.match(redesign, /\.workspace-topbar\{position:fixed;inset:0 0 auto var\(--ui-sidebar-width\)/);
  assert.match(library, /className="library-sticky-controls"[\s\S]*className="library-hero"[\s\S]*className="library-filter-panel"/);
  assert.match(library, /new ResizeObserver\(measure\)/);
  assert.match(library, /className="library-sticky-spacer" style=\{\{ height: controlsHeight \}\}/);
  assert.ok(library.indexOf("library-personal-shelf") < library.indexOf("SHELVES.map"));
  assert.match(library, /key: "doing", title: "Tiếp tục học"[\s\S]*key: "fresh", title: "Bài học mới"[\s\S]*key: "noCaption"[\s\S]*key: "finished"/);
  assert.match(redesign, /\.lesson-library-v2 \.library-sticky-controls\{\s*position:fixed;inset:var\(--ui-topbar-height\) 0 auto var\(--ui-sidebar-width\)/);
  assert.match(redesign, /\.lesson-library-v2 \.library-hero\{\s*position:static/);
  assert.match(redesign, /\.lesson-library-v2 \.library-filter-panel\{\s*position:static/);
  assert.match(redesign, /\.lesson-library-v2\{\s*padding-top:0;background:transparent;color:var\(--ui-text\)/);
  assert.match(redesign, /animation:none;transform:none/);
  assert.match(redesign, /\.lesson-library-v2 \.catalogue-open\{[\s\S]*background:var\(--ui-card\);color:var\(--ui-text\)/);
  assert.match(page, /const worksWithoutVocabulary = mode === "dictation" \|\| mode === "shadow" \|\| mode === "speak" \|\| mode === "translate" \|\| translating;\s*if \(!words\.length && !worksWithoutVocabulary\)/);
  assert.doesNotMatch(redesign, /\.lexilo-workspace\[data-section="(?:words|practice|stats|dictionary)"\]\{\s*--section-accent/);
  assert.match(redesign, /\.home-stat:nth-child\(4\)/);
  assert.match(redesign, /\.review-modes button:nth-child\(4n\)/);
});

test("opens unfinished skill sessions and starts skill tools without stale practice state", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const openLesson = page.slice(page.indexOf("const openVideoLesson"), page.indexOf("const withSystemLessons"));
  const openTool = page.slice(page.indexOf("const openTool"), page.indexOf("const [detailWord"));
  const skillHub = page.slice(page.indexOf("function SkillHub"), page.indexOf("function Dashboard"));

  assert.match(openLesson, /setSkillHub\(null\)[\s\S]*setLessonLaunch\(\{ videoId, mode/);
  assert.match(openTool, /setLessonLaunch\(null\)/);
  assert.match(openTool, /localStorage\.removeItem\(practiceShellSessionKey\)/);
  assert.match(skillHub, /onClick=\{\(\) => openLesson\(unfinished\.lesson\.videoId, mode\)\}/);
  assert.match(skillHub, /className="skill-tool" onClick=\{\(\) => open\(tool\)\}/);
  assert.match(page, /const worksWithoutVocabulary = mode === "dictation" \|\| mode === "shadow" \|\| mode === "speak" \|\| mode === "translate" \|\| translating/);
});

test("returns every practice tool to its owning skill hub", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const practice = page.slice(page.indexOf("function Practice"), page.indexOf("function FolderPicker"));

  assert.match(page, /function skillHubForPractice[\s\S]*intent === "dictation"[\s\S]*return "listen"/);
  assert.match(page, /intent === "shadow" \|\| intent === "speak"[\s\S]*return "speak"/);
  assert.match(page, /intent === "translate"[\s\S]*return "write"/);
  assert.match(page, /openSkill\(skillHubForPractice\(practiceIntent\)\)/);
  assert.match(practice, /SpeakingPractice close=\{onExitTool\}/);
  assert.match(practice, /LessonLibrary[\s\S]*close=\{onExitTool\}/);
  assert.match(practice, /VocabPractice[\s\S]*close=\{onExitTool\}/);
  // Cửa vào Luyện viết là màn GỐC (bấm thẳng từ cột trái và thanh dưới), nên
  // nó không nhận close: nút "về trang chủ" ở đó chỉ lặp lại thứ đã luôn hiện sẵn.
  assert.doesNotMatch(practice, /WritingPractice[sS]*close=/);
  assert.match(practice, /MatchGame words=\{activeWords\} close=\{returnToVocabPractice\}/);
  // Màn "chưa có từ nào" chỉ tới được từ luồng từ vựng: guard worksWithoutVocabulary
  // ngay phía trên đã loại hết dictation/shadow/speak/translate. Trước đây chỗ này
  // là một chuỗi ba nhánh chọn đích theo mode, nhưng TypeScript chỉ ra không nhánh
  // nào trong số đó chạy được — nên đích lùi luôn là Từ vựng.
  assert.match(practice, /<BackButton destination="Từ vựng" onClick=\{onExitTool\} \/>/);
});

test("opens the three writing paths directly from the Writing workspace", async () => {
  const [page, writing] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/WritingPractice.tsx", import.meta.url), "utf8"),
  ]);
  const openSkill = page.slice(page.indexOf("const openSkill"), page.indexOf("const openTool"));

  assert.match(openSkill, /id === "write"[\s\S]*setSkillHub\(null\)[\s\S]*setPracticeIntent\("translate"\)[\s\S]*setTab\("practice"\)/);
  assert.match(page, /key=\{`practice-\$\{practiceLaunch\}/);
  assert.match(page, /tab === "practice" \? \(libraryLaunch \? "Video của tôi" : practiceNav\.find/);
  assert.match(writing, /<h1>Viết<\/h1>/);
  assert.match(writing, /Dịch đoạn văn có sẵn/);
  assert.match(writing, /Viết theo kỳ thi/);
  assert.match(writing, /Viết bằng từ vựng của bạn/);
  assert.doesNotMatch(writing, /← Trang chủ/);
  assert.equal((writing.match(/<BackButton destination="Viết"/g) ?? []).length, 2);
  assert.doesNotMatch(writing, /← Chọn chức năng khác|← Luyện viết|<button className="back/);
  assert.match(page, /Chưa có từ để tạo bài viết/);
});

// Kế hoạch hôm nay từng có hai bước dùng CHUNG một hàm đã gắn sẵn "dictation",
// nên bấm "Nói/viết" lại rơi vào Nghe chép. Test khoá lại: mỗi bước phải tự khai
// chế độ của nó, và Trang chủ phải truyền thẳng openPractice chứ không bọc lại
// bằng một chế độ cố định.
test("mỗi bước trong kế hoạch hôm nay mở đúng màn của bước đó", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const plan = page.slice(page.indexOf("function LearningPlan("), page.indexOf("function DailyStudy("));

  // Ba bước video/nói dùng mảng; Review, Error Practice và Writing có hành động riêng.
  const modes = [...plan.matchAll(/mode: "([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(modes, ["dictation", "shadow", "speak"]);
  assert.equal(new Set(modes).size, modes.length);
  // Bước 01 là từ vựng, đi bằng đường riêng chứ không qua openPractice.
  assert.match(plan, /onClick=\{startVocabulary\}/);
  assert.match(plan, /onClick=\{\(\) => openPractice\(step\.mode\)\}/);

  assert.match(plan, /Review → Listening → Shadowing → Speaking → Error Practice/);
  assert.match(plan, /openPractice\("translate"\)/);
  assert.match(plan, /onClick=\{openErrors\}/);

  // Nơi gọi phải chuyền thẳng hàm điều hướng. Bọc lại bằng một chế độ cố định —
  // openPractice={() => openPractice("dictation")} — chính là lỗi cũ.
  const call = page.slice(page.indexOf("<LearningPlan "), page.indexOf("<LearningPlan ") + 400);
  assert.match(call, /openPractice={openPractice}/);
  assert.doesNotMatch(call, /openPractice={() =>/);
});

// Kho từ vựng và Từ điển AI là công cụ "tab" của không gian Từ vựng, nhưng nhánh
// tab trong openTool không lưu lại nơi xuất phát nên hai màn đó từng cụt đường
// lùi. Test khoá lại cả hai mặt: có đường lùi khi vào từ kỹ năng, và KHÔNG có
// khi vào thẳng — nút lùi chỉ có nghĩa khi nó đi lên đúng một cấp.
test("công cụ mở từ không gian kỹ năng thì có đường lùi, vào thẳng thì không", async () => {
  const [page, dictionary] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/Dictionary.tsx", import.meta.url), "utf8"),
  ]);

  // openTool ghi lại kỹ năng đang mở TRƯỚC khi xoá nó đi.
  const openTool = page.slice(page.indexOf("const openTool = "), page.indexOf("const [detailWord"));
  const setOrigin = openTool.indexOf("setToolOrigin(skillHub)");
  const clearHub = openTool.indexOf("setSkillHub(null)");
  assert.ok(setOrigin > -1 && clearHub > -1, "openTool phải làm cả hai việc");
  assert.ok(setOrigin < clearHub, "ghi lại nơi xuất phát trước khi xoá, nếu không luôn là null");

  // Đi thẳng từ sườn trái hay thanh trên cùng thì xoá nơi xuất phát.
  const goTab = page.slice(page.indexOf("const goTab = "), page.indexOf("/** Mở màn tổng quan"));
  assert.match(goTab, /setToolOrigin\(null\)/);

  // Cả hai màn đều nhận đường lùi, và chỉ hiện nút khi thật sự có đường.
  assert.match(page, /<Words\b[\s\S]{0,900}?onExitTool=\{toolOrigin \? \(\) => openSkill\(toolOrigin\) : undefined\}/);
  assert.match(page, /<Dictionary\b[\s\S]{0,300}?onExitTool=\{dictionaryOrigin \? returnFromDictionary : toolOrigin \? \(\) => openSkill\(toolOrigin\) : undefined\}/);
  assert.match(dictionary, /\{onExitTool && \(/);
  // Ở trong thư mục con thì đường dẫn lo việc lùi từng cấp, không hiện thêm nút.
  assert.match(page, /\{onExitTool && atRoot && \(/);
});

test("từ điển quay lại đúng màn nguồn và ví dụ cụm từ dùng ngữ cảnh thật", async () => {
  const [page, dictionary, route] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/Dictionary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/enrich/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /setDictionaryOrigin\(\{ tab, skillHub, reviewing, label:/);
  assert.match(page, /function returnFromDictionary\(\)[\s\S]*setTab\(dictionaryOrigin\.tab\)[\s\S]*setReviewing\(dictionaryOrigin\.reviewing\)/);
  assert.match(page, /openDictionary: openDictionaryPage/);
  assert.match(dictionary, /<BackButton destination=\{backDestination \|\| "Từ vựng"\}/);
  assert.match(route, /"ears scratched":\{phrase:"have one's ears scratched"[\s\S]*The dog loves having his ears scratched\./);
  assert.match(route, /const practical=practicalPhrases\[word\];[\s\S]*const example=practical\?\.example\?\?corpus\?\.text\?\?frame\.example/);
});

// Mỗi màn từng tự vẽ một kiểu nút lùi: chỗ chữ tím trơn, chỗ ô vuông chỉ có mũi
// tên với màu cắm cứng không theo chủ đề. Test giữ cho tất cả đi qua một lớp
// BackButton duy nhất, để nhãn, trợ năng và kiểu dáng không thể lệch giữa bốn kỹ năng.
test("mọi màn con của bốn kỹ năng dùng chung BackButton", async () => {
  const files = ["../app/page.tsx", "../components/Dictionary.tsx", "../components/LessonLibrary.tsx",
    "../components/VideoLesson.tsx", "../components/SpeakingPractice.tsx", "../components/VocabPractice.tsx",
    "../components/WritingPractice.tsx"];
  const sources = await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), "utf8")));

  for (const [index, source] of sources.entries()) {
    // Không màn nào được tự vẽ lại nút lùi. Cặp ←/→ để lật thẻ là phân trang,
    // không mang class .back nên không tính vào hợp đồng này.
    assert.doesNotMatch(source, /<button[^>]*className="[^"]*\bback\b/, `${files[index]} còn tự dựng nút .back`);
    assert.doesNotMatch(source, /<button[^>]*>\s*←\s*(?:Quay lại|Chọn|Đổi|Viết|Thư viện)/, `${files[index]} còn nhãn nút lùi viết tay`);
  }

  const component = await readFile(new URL("../components/BackButton.tsx", import.meta.url), "utf8");
  assert.match(component, /className="back app-back-button"/);
  assert.match(component, /<span>Quay lại \{destination\}<\/span>/);
  assert.match(component, /type="button"/);

  // Không còn biến thể chỉ có mũi tên hoặc lớp riêng cạnh tranh cho cùng một việc.
  const all = sources.join("\n");
  assert.doesNotMatch(all, /className="library-back"/);
  assert.doesNotMatch(all, /className="back tool-back"/);
  assert.doesNotMatch(all, /className="drill-icon"[^>]*aria-label="Quay lại/);
  assert.doesNotMatch(all, /\bis-icon\b/);

  // Kiểu dáng nằm một chỗ và luôn có cùng chiều cao, độ bo.
  const css = await readFile(new URL("../app/workspace-redesign.css", import.meta.url), "utf8");
  assert.match(css, /\.lexilo-workspace \.back \{/);
  assert.match(css, /\.lexilo-workspace \.back\.app-back-button \{[\s\S]*min-height: 36px;[\s\S]*border-radius: 10px;/);
  assert.doesNotMatch(css, /\.back\.is-icon/);
  // Màu phải lấy từ biến chủ đề, nếu không thì chủ đề sáng lại có ô đen như cũ.
  const block = css.slice(css.indexOf(".lexilo-workspace .back {"), css.indexOf("/* Chỉ khoảng cách"));
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,6}/, "nút lùi không được cắm cứng mã màu");
});

// Hai luồng từ vựng — màn "Luyện từ vựng" và phiên ôn — làm cùng một việc với
// cùng sáu kiểu, nhưng từng là hai bộ code song song: hai bảng nhãn, hai danh
// sách vòng xoay, hai cách xử lý kiểu mà bộ thẻ không đủ dữ liệu. Test giữ cho
// chúng chỉ còn một nguồn.
test("hai luồng từ vựng dùng chung một nguồn cho nhãn, vòng xoay và điều kiện", async () => {
  const [page, drill, vocab] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/vocab-drill.mjs", import.meta.url), "utf8"),
    readFile(new URL("../components/VocabPractice.tsx", import.meta.url), "utf8"),
  ]);

  // Nhãn và mô tả suy ra từ DRILL_MODES, không chép tay lần thứ hai.
  assert.match(page, /const reviewModes[\s\S]{0,200}= DRILL_MODES\.map\(/);
  assert.doesNotMatch(page, /label: "Thẻ ghi nhớ"/);

  // Vòng xoay của "Luyện tổng hợp" cũng vậy — trước đây là một mảng chép tay
  // cùng nội dung nhưng khác thứ tự, nên cùng một lựa chọn cho ra hai chuỗi bài.
  assert.match(page, /rotatingModes[\s\S]{0,120}MIXED_POOL/);
  assert.doesNotMatch(page, /rotatingModes: ReviewMode\[\] = \["/);

  // Bảng ánh xạ hai chiều suy ra từ nhau, không khai hai lần.
  assert.match(page, /reviewToDrillMode = Object\.fromEntries/);

  // Kiểu mà bộ thẻ chưa đủ dữ liệu bị chặn ở CẢ HAI màn, bằng cùng một hàm.
  assert.match(vocab, /disabled=\{!deckSupports\(deck, item\.value\)\}/);
  assert.match(page, /disabled=\{!deckSupports\(deck, reviewToDrillMode\[item\.value\]\)\}/);
  assert.match(drill, /export function deckSupports/);

  // Cả hai vào bằng cùng một kiểu mặc định.
  assert.match(page, /useState<ReviewMode>\("mixed"\)/);
  assert.match(vocab, /useState<Mode>\("mixed"\)/);
});

// Một ô trống trong thẻ từ chỉ được làm mất một dòng chữ, không được làm sập
// phiên học. Từ lưu từ bản cũ hoàn toàn có thể thiếu cloze hoặc definition.
test("chữ tiếng Anh thiếu nội dung thì bỏ qua, không làm sập màn", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const fn = page.slice(page.indexOf("function EnglishText"), page.indexOf("function EnglishText") + 3000);
  assert.match(fn, /if \(!text\) return null;[\s\S]{0,200}text\.split/);
});
