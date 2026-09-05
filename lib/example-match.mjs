// Match a vocabulary item as a complete word or phrase. Prefix matching is not
// safe here: "closets" and "closeted" share letters but use different grammar
// and, in many dictionary entries, a different meaning.
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function nounForms(term) {
  const forms = new Set([term]);
  if (/[^aeiou]ies$/i.test(term)) forms.add(term.replace(/ies$/i, "y"));
  else if (/(?:ches|shes|sses|xes|zes)$/i.test(term)) forms.add(term.replace(/es$/i, ""));
  else if (/s$/i.test(term) && !/(?:ss|us|is)$/i.test(term)) forms.add(term.slice(0, -1));
  else if (/[^aeiou]y$/i.test(term)) forms.add(`${term.slice(0, -1)}ies`);
  else if (/(?:s|x|z|ch|sh)$/i.test(term)) forms.add(`${term}es`);
  else forms.add(`${term}s`);
  return forms;
}

export function vocabularyForms(rawTerm, partOfSpeech = "") {
  const term = String(rawTerm ?? "").trim().toLowerCase();
  if (!term) return [];
  // A multi-word item should appear as that phrase. Generating inflections for
  // the last word without parsing the phrase creates more false positives.
  if (/\s/.test(term)) return [term];

  const forms = nounForms(term);
  // Chia động từ CHỈ từ chính chữ người học đang học, không từ mọi dạng danh từ
  // suy ra được. Nếu sinh từ cả dạng số ít thì thẻ "closets" chấp nhận câu dùng
  // "closeted" — cùng gốc chữ nhưng khác từ loại và khác nghĩa hẳn. Người học
  // thẻ "closets" (cái tủ) không học được gì từ một câu về "closeted" (họp kín).
  if (/verb/i.test(partOfSpeech)) {
    forms.add(`${term}ed`);
    forms.add(`${term}ing`);
    if (/e$/i.test(term)) {
      forms.add(`${term}d`);
      forms.add(`${term.slice(0, -1)}ing`);
    }
  }
  return [...forms].sort((a, b) => b.length - a.length);
}

export function exampleUsesVocabulary(text, term, partOfSpeech = "") {
  const forms = vocabularyForms(term, partOfSpeech);
  if (!text || !forms.length) return false;
  const alternatives = forms.map(escapeRegExp).join("|");
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}'’-])(?:${alternatives})(?=$|[^\\p{L}\\p{N}'’-])`, "iu");
  return pattern.test(String(text));
}
