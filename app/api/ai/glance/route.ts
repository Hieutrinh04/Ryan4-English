import { NextResponse } from "next/server";
import { collocationsFrom, lemmaCandidates, sensesFromDatamuse } from "../../../../lib/dictionary-fallback.mjs";
import { estimateCefr, frequencyFromTags, higherBandWords } from "../../../../lib/word-level.mjs";
import { translateBatch } from "../../../../lib/translate.mjs";
import { normalizeIpa } from "../../../../lib/arpabet.mjs";

// Tra một từ HOẶC một cụm khi bấm/tra trong Từ điển AI: IPA, loại từ, nghĩa tiếng
// Anh, từ đồng nghĩa, CỤM TỪ KẾT HỢP (collocation) và từ NÂNG CẤP (bậc cao hơn).
// KHÔNG gọi mô hình ngôn ngữ nên tra bao nhiêu lần cũng được. Bản dịch tiếng Việt
// làm ngay tại đây (xem lib/translate.mjs) — trước đây để trình duyệt tự dịch
// nhưng Google Dịch giờ chặn CORS.

type DictionaryEntry = {
  phonetic?: string;
  phonetics?: { text?: string }[];
  meanings?: { partOfSpeech?: string; definitions?: { definition?: string }[]; synonyms?: string[] }[];
};

type Sense = { part: string; definition: string; synonyms: string[] };

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function fromDictionary(data: unknown) {
  const list = Array.isArray(data) ? (data as DictionaryEntry[]) : [];
  const rawIpa = list.find((entry) => entry.phonetic)?.phonetic || list.flatMap((entry) => entry.phonetics ?? []).find((item) => item.text)?.text || "";
  const ipa = normalizeIpa(rawIpa);
  const senses: Sense[] = [];
  for (const entry of list)
    for (const meaning of entry.meanings ?? []) {
      const part = meaning.partOfSpeech ?? "";
      if (!part || senses.some((item) => item.part === part)) continue;
      const definition = meaning.definitions?.[0]?.definition ?? "";
      if (!definition) continue;
      senses.push({ part, definition, synonyms: (meaning.synonyms ?? []).slice(0, 5) });
      if (senses.length >= 4) break;
    }
  return senses.length ? { ipa, senses } : null;
}

async function lookupForm(form: string) {
  const [dictionary, datamuse] = await Promise.all([
    fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(form)}`),
    fetchJson(`https://api.datamuse.com/words?sp=${encodeURIComponent(form)}&md=dpr&max=3`),
  ]);
  return fromDictionary(dictionary) ?? sensesFromDatamuse(datamuse, form);
}

/** Cụm hay đứng ngay trước / ngay sau từ này (Datamuse bigram). */
async function collocationsFor(word: string) {
  const [before, after] = await Promise.all([
    fetchJson(`https://api.datamuse.com/words?rel_bgb=${encodeURIComponent(word)}&max=12`),
    fetchJson(`https://api.datamuse.com/words?rel_bga=${encodeURIComponent(word)}&max=12`),
  ]);
  return collocationsFrom(before, after, word);
}

type Scored = { word?: string; tags?: string[] };

const POS_TAG: Record<string, string> = { noun: "n", verb: "v", adjective: "adj", adverb: "adv" };

/**
 * Bậc CEFR ước lượng của từ, kèm từ đồng nghĩa "đáng học lên" — bậc CEFR cao hơn
 * hoặc hiếm hơn hẳn. Ví dụ: certificate (B2) → credential (C1), happy → contented.
 *
 * Nguồn: `ml=` nhưng CHỈ giữ mục gắn nhãn "syn" (đồng nghĩa thật, không phải "từ
 * liên quan" chung chung — thứ khiến "insects" ra "bees, bug"). Lọc thêm theo
 * loại từ của từ gốc để "weather" (danh từ) không nhặt "endure, brave" (động từ).
 */
async function levelAndUpgrades(word: string, baseParts: string[]) {
  const [self, meansLike] = await Promise.all([
    fetchJson(`https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=f&max=1`),
    fetchJson(`https://api.datamuse.com/words?ml=${encodeURIComponent(word)}&md=fp&max=24`),
  ]);
  const selfFreq = frequencyFromTags((Array.isArray(self) ? (self[0] as Scored)?.tags : undefined) ?? []);
  const level = estimateCefr(word, selfFreq);
  if (!level) return { level: null, upgrades: [] };

  // Loại từ của từ gốc (mọi nghĩa). Từ đồng nghĩa phải khớp ÍT NHẤT một loại — để
  // "weather" (danh từ/động từ) không nhặt phải nghĩa lệch hẳn.
  const wantPos = new Set(baseParts.map((part) => POS_TAG[part]).filter(Boolean));
  const POS = ["n", "v", "adj", "adv"];
  const stem = word.replace(/(ies|es|s)$/, "");
  const isVariant = (term: string) => term === word || term.startsWith(stem) || word.startsWith(term.replace(/(ing|ed|s)$/, ""));

  const scored = (Array.isArray(meansLike) ? (meansLike as Scored[]) : [])
    .map((item) => {
      const term = String(item.word ?? "").toLowerCase().trim();
      const tags = item.tags ?? [];
      if (!term || term.includes(" ") || !/^[a-z][a-z'-]*$/.test(term) || isVariant(term)) return null;
      if (!tags.includes("syn")) return null;
      if (wantPos.size && tags.some((tag) => POS.includes(tag)) && !tags.some((tag) => wantPos.has(tag))) return null;
      const freq = frequencyFromTags(tags);
      // Bỏ từ quá hiếm (dưới ~0.4 lần/triệu): cổ, hiếm gặp, dạy cũng không dùng
      // được — "felicitous", "paradisaical", "pulchritudinous".
      if (Number.isFinite(freq) && freq > 0 && freq < 0.4) return null;
      const est = estimateCefr(term, freq);
      return est ? { word: term, level: est.level, freq } : null;
    })
    .filter((item): item is { word: string; level: string; freq: number } => item !== null);

  return { level, upgrades: higherBandWords(level.level, selfFreq, scored, 6) };
}

type Vi = { meaningVi: string; senses: { meaningVi: string }[]; collocations: { en: string; vi: string }[]; upgrades: { word: string; vi: string; level: string }[] };

/** Dịch tất cả phần cần tiếng Việt trong một lượt gọi. */
async function withVietnamese(term: string, senses: Sense[], collocations: { before: string[]; after: string[] } | null, upgrades: { word: string; level: string }[]): Promise<Vi> {
  const collos = collocations ? [...collocations.before, ...collocations.after] : [];
  const vi = await translateBatch([term, ...senses.map((s) => s.definition), ...collos, ...upgrades.map((u) => u.word)]);
  const cBase = 1 + senses.length;
  const uBase = cBase + collos.length;
  const wordVi = vi[0] && vi[0].toLowerCase() !== term.toLowerCase() ? vi[0] : "";
  return {
    meaningVi: wordVi,
    senses: senses.map((_, i) => ({ meaningVi: vi[1 + i] ?? "" })),
    collocations: collos.map((en, i) => ({ en, vi: vi[cBase + i] ?? "" })),
    upgrades: upgrades.map((u, i) => ({ ...u, vi: vi[uBase + i] ?? "" })),
  };
}

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? "";
  const words = raw.split(/\s+/).filter(Boolean);

  // ── Cụm từ: 2–6 từ, chỉ dịch, không tra từ điển đơn ────────────────────────
  if (words.length >= 2) {
    if (words.length > 6 || !words.every((part) => /^[a-z][a-z'.,-]*$/.test(part))) {
      return NextResponse.json({ error: "Cụm quá dài hoặc có ký tự lạ." }, { status: 400 });
    }
    const phrase = words.join(" ");
    const [meaningVi] = await translateBatch([phrase]);
    return NextResponse.json({ term: phrase, isPhrase: true, ipa: "", meaningVi: meaningVi ?? "", senses: [], collocations: null, upgrades: [] });
  }

  const word = words[0] ?? "";
  if (!word || !/^[a-z][a-z'-]{0,30}$/.test(word)) return NextResponse.json({ error: "Từ không hợp lệ." }, { status: 400 });

  let found = await lookupForm(word);
  let base = word;
  if (!found) {
    for (const candidate of lemmaCandidates(word)) {
      found = await lookupForm(candidate);
      if (found) { base = candidate; break; }
    }
  }
  if (!found) return NextResponse.json({ error: "Không tra được từ này." }, { status: 404 });

  const baseParts = [...new Set(found.senses.map((sense) => sense.part).filter(Boolean))];
  const [collocations, level] = await Promise.all([collocationsFor(base), levelAndUpgrades(base, baseParts)]);
  const vi = await withVietnamese(word, found.senses, collocations, level.upgrades);
  return NextResponse.json({
    term: word,
    base,
    isPhrase: false,
    ipa: found.ipa,
    meaningVi: vi.meaningVi,
    senses: found.senses.map((sense, index) => ({ ...sense, meaningVi: vi.senses[index]?.meaningVi ?? "" })),
    collocations: vi.collocations, // [{ en, vi }]
    level: level.level, // { level: "B2", source: "oxford" | "frequency" } | null
    upgrades: vi.upgrades, // [{ word, level, vi }]
  });
}
