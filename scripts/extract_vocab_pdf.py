import json
import re
import sys
from pathlib import Path

import pdfplumber


def grouped_lines(words, tolerance=2.0):
    lines = []
    for word in sorted(words, key=lambda item: (item["top"], item["x0"])):
        line = next((row for row in reversed(lines[-3:]) if abs(row[0]["top"] - word["top"]) <= tolerance), None)
        if line is None:
            line = []
            lines.append(line)
        line.append(word)
    return lines


def clean_join(tokens):
    text = " ".join(token.strip() for token in tokens if token.strip())
    text = re.sub(r"\s+([,.;:)])", r"\1", text)
    text = re.sub(r"([(])\s+", r"\1", text)
    return re.sub(r"\s+", " ", text).strip()


def main(source, target):
    records = []
    current_topic = "Từ vựng chung"
    topics_seen = []
    with pdfplumber.open(source) as pdf:
        for page in pdf.pages:
            words = page.extract_words(x_tolerance=1, y_tolerance=2)
            lines = grouped_lines(words)
            headings = []
            for line in lines:
                line_text = clean_join([w["text"] for w in sorted(line, key=lambda item: item["x0"])])
                if re.search(r"[A-ZÀ-Ỹ]{2,}\s*-\s*[A-ZÀ-Ỹ]{2,}", line_text) and not any(w["text"].isdigit() for w in line):
                    headings.append((min(w["top"] for w in line), line_text))

            row_starts = []
            for word in words:
                if word["text"].isdigit() and 75 <= word["x0"] <= 105 and 1 <= int(word["text"]) <= 1100:
                    row_starts.append((word["top"], int(word["text"])))
            row_starts.sort()

            for row_index, (top, number) in enumerate(row_starts):
                for heading_top, heading in headings:
                    if heading_top < top:
                        current_topic = heading
                        if heading not in topics_seen:
                            topics_seen.append(heading)
                bottom = row_starts[row_index + 1][0] - 1 if row_index + 1 < len(row_starts) else page.height - 35
                row_words = [w for w in words if top - 1 <= w["top"] <= bottom and w["text"] != str(number)]
                term_tokens = [w["text"] for w in sorted(row_words, key=lambda item: (item["top"], item["x0"])) if 105 <= w["x0"] < 235]
                pos_tokens = [token for token in term_tokens if re.fullmatch(r"\((?:n|v|adj|adv|prep|pron|det|conj)\)", token, re.I)]
                term_tokens = [token for token in term_tokens if token not in pos_tokens]
                ipa_tokens = [w["text"] for w in sorted(row_words, key=lambda item: (item["top"], item["x0"])) if 235 <= w["x0"] < 385]
                meaning_tokens = [w["text"] for w in sorted(row_words, key=lambda item: (item["top"], item["x0"])) if w["x0"] >= 385]
                term = clean_join(term_tokens)
                if not term:
                    continue
                records.append({
                    "number": number,
                    "term": term,
                    "partOfSpeech": pos_tokens[0].strip("()") if pos_tokens else "",
                    "ipa": clean_join(ipa_tokens),
                    "meaning": clean_join(meaning_tokens),
                    "topic": current_topic,
                    "source": "1000 từ vựng tiếng Anh cơ bản - MochiMochi",
                })

    # Prefer the first occurrence of an exact numbered row and keep source order.
    unique = {}
    for record in records:
        unique.setdefault(record["number"], record)
    ordered = [unique[key] for key in sorted(unique)]
    corrections = {
        1: {"ipa": "/əˈkaʊn.t̬ənt/"},
        2: {"ipa": "/ˈæk.tɚ/ /ˈæk.trəs/"},
        983: {"term": "Celsius (degree)", "partOfSpeech": "adj", "ipa": "/ˈselsiəs/", "meaning": "độ C"},
    }
    for record in ordered:
        record.update(corrections.get(record["number"], {}))
    Path(target).parent.mkdir(parents=True, exist_ok=True)
    Path(target).write_text(json.dumps(ordered, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"count": len(ordered), "first": ordered[:2], "last": ordered[-2:], "topics": topics_seen}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
