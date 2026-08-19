// Lọc danh sách "từ hay đi cùng chủ đề" lấy từ Datamuse rel_trg.
//
// Vì sao cần lọc: rel_trg trả về từ hay xuất hiện chung trong kho ngữ liệu, nhưng
// điểm số của nó gần như phẳng (rescue: 1470 cho "firefighting" so với 1359 cho
// "trapped") nên không dùng để xếp hạng được. Kết quả thô đầy nhiễu:
//     rescue    → firefighting, downed, lifeboat, sar
//     baker     → eddy, holmes, hughes, oregon        (phố Baker, hạt Baker)
//     butcher   → patsy, eastenders                   (nhân vật phim truyền hình)
//     balcony   → balconies, proscenium, entablature  (biến thể của chính nó, thuật ngữ hiếm)
//
// Tín hiệu dùng được là tần suất `f` trong thẻ md=fp: "sar" 1.3, "lifeboat" 0.5,
// "firefighting" 0.2 đều là từ hiếm/viết tắt, còn "helicopter" 3.3, "trapped" 7.1
// mới là từ người học IELTS thật sự cần.

// Số lần xuất hiện trên một triệu từ. Đặt 1.5 vì đây là mức tách được "sar" (1.27)
// và "volcanoes" (1.4) khỏi "eyelid" (1.52) và "locker" (1.82).
const MIN_FREQUENCY = 1.5;
const CONTENT_TAGS = ["n", "v", "adj", "adv"];

// Dạng gốc thô sơ, chỉ để nhận ra hai từ là biến thể của nhau:
// balconies→balcony, blinking→blink, crops→crop, rescued→rescu ≈ rescue→rescu.
export function rootOf(word) {
  let value = word.toLowerCase();
  if (/ies$/.test(value)) value = `${value.slice(0, -3)}y`;
  else if (/(ches|shes|sses|xes|zes)$/.test(value)) value = value.slice(0, -2);
  else if (/s$/.test(value) && !/(ss|us|is)$/.test(value)) value = value.slice(0, -1);
  if (/ing$/.test(value)) value = value.slice(0, -3);
  else if (/ed$/.test(value)) value = value.slice(0, -2);
  return value.replace(/e$/, "");
}

// Số gợi ý tối thiểu trước khi phải mượn thêm từ cùng folder.
export const MIN_SUGGESTIONS = 4;

// Bỏ nhiễu OCR trong từ khoá PDF nhưng vẫn giữ cụm nhiều chữ:
// "starfruit (n)" → "starfruit", "actor/ actress" → "actor", "water lily" giữ nguyên.
export function displayTerm(term) {
  const cleaned = term.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return cleaned.split("/")[0].trim();
}

// Datamuse lấy dữ liệu từ kho ngữ liệu kiểu Wikipedia nên với những nhóm từ hẹp
// (trái cây, rau củ) nó chỉ còn lại thuật ngữ thực vật học hiếm, bị bộ lọc trên
// cắt sạch. Với bộ từ PDF thì folder chủ đề là nguồn tốt hơn hẳn: đó đúng là "từ
// cùng chủ đề", lại là từ người học đã có sẵn nghĩa và câu ví dụ trong app.
// folder: [{ term, number }] gồm mọi từ cùng chủ đề, kể cả chính nó.
export function topicNeighbours(term, folder, exclude, need) {
  if (need <= 0) return [];
  const self = displayTerm(term);
  const taken = new Set([...exclude, self].map(rootOf));
  const position = folder.find((item) => displayTerm(item.term) === self)?.number ?? 0;
  return folder
    // Từ đứng gần nhau trong folder thường sát nghĩa nhau nhất (apple, banana, pear…).
    .map((item) => ({ word: displayTerm(item.term), distance: Math.abs((item.number ?? 0) - position) }))
    .sort((a, b) => a.distance - b.distance)
    .filter((item) => {
      if (!item.word || taken.has(rootOf(item.word))) return false;
      taken.add(rootOf(item.word));
      return true;
    })
    .slice(0, need)
    .map((item) => item.word);
}

// items: kết quả thô của Datamuse với md=fp, tức [{ word, tags: ["n", "f:3.32"] }].
export function topicalWords(items, source, limit = 6) {
  const sourceRoot = rootOf(source);
  const kept = [];
  const takenRoots = new Set([sourceRoot]);
  for (const item of items) {
    const word = (item?.word ?? "").trim().toLowerCase();
    const tags = item?.tags ?? [];
    // Chỉ nhận một từ đơn viết bằng chữ cái: loại "st. john", "3d", ký tự lạ.
    if (!/^[a-z][a-z'-]*$/.test(word)) continue;
    // Danh từ riêng: eddy, oregon, eminem, selene — không phải từ vựng chủ đề.
    if (tags.includes("prop")) continue;
    // Không có nhãn loại từ nghĩa là Datamuse cũng không biết đây là từ gì.
    if (!CONTENT_TAGS.some((tag) => tags.includes(tag))) continue;
    const frequency = Number.parseFloat((tags.find((tag) => tag.startsWith("f:")) ?? "f:0").slice(2));
    if (!(frequency >= MIN_FREQUENCY)) continue;
    // Biến thể của từ đang học, hoặc trùng gốc với từ đã chọn (crop/crops).
    const root = rootOf(word);
    if (takenRoots.has(root)) continue;
    takenRoots.add(root);
    kept.push(word);
    if (kept.length >= limit) break;
  }
  return kept;
}
