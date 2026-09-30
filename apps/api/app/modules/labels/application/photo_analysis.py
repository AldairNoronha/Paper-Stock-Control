"""Spatial extraction from full-photo OCR. Every suggestion still requires human review."""

import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from itertools import pairwise

from pydantic import BaseModel, Field

FIELD_NAMES = (
    "supplier",
    "material",
    "sheets",
    "width_mm",
    "length_mm",
    "lot",
    "pallet",
    "area_m2",
    "weight_kg",
    "production_date",
    "expiry_date",
    "order",
    "pallet_number",
    "sscc",
)
CRITICAL = ("supplier", "material", "sheets", "width_mm", "length_mm")


class Box(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(ge=0, le=1)
    height: float = Field(ge=0, le=1)


class PhotoField(BaseModel):
    value: str | None = None
    status: str = "missing"
    source_text: str | None = None
    box: Box | None = None
    ocr_confidence: float | None = None
    method: str | None = None


class PhotoAnalysis(BaseModel):
    version: str = "photo-v2.1"
    provider: str = "google-vision"
    image_width: int
    image_height: int
    fields: dict[str, PhotoField]
    missing_critical: list[str]
    warnings: list[str]
    calculated_area_m2: float | None = None
    raw_text: str


@dataclass(frozen=True)
class Word:
    text: str
    x: float
    y: float
    right: float
    bottom: float
    confidence: float | None = None

    @property
    def height(self) -> float:
        return max(1, self.bottom - self.y)


def normalized(value: str) -> str:
    return "".join(
        char
        for char in unicodedata.normalize("NFKD", value.upper())
        if not unicodedata.combining(char)
    )


def rows_of(words: list[Word]) -> list[list[Word]]:
    rows: list[list[Word]] = []
    for word in sorted(words, key=lambda item: (item.y, item.x)):
        center = (word.y + word.bottom) / 2
        row = next(
            (
                row
                for row in rows
                if abs(center - sum((item.y + item.bottom) / 2 for item in row) / len(row))
                <= min(word.height, min(item.height for item in row)) * 0.55
            ),
            None,
        )
        if row is None:
            rows.append([word])
        else:
            row.append(word)
    return [sorted(row, key=lambda item: item.x) for row in rows]


def span(words: list[Word]) -> Word:
    confidences = [word.confidence for word in words if word.confidence is not None]
    return Word(
        " ".join(word.text for word in words),
        min(word.x for word in words),
        min(word.y for word in words),
        max(word.right for word in words),
        max(word.bottom for word in words),
        min(confidences) if confidences else None,
    )


def anchors(rows: list[list[Word]], pattern: str) -> list[Word]:
    found: list[Word] = []
    for row in rows:
        for start in range(len(row)):
            for size in range(1, min(6, len(row) - start) + 1):
                parts = row[start : start + size]
                if any(b.x - a.right > max(a.height, b.height) * 2 for a, b in pairwise(parts)):
                    break
                candidate = span(parts)
                if re.fullmatch(pattern, normalized(candidate.text).strip(" :")):
                    found.append(candidate)
                    break
    return found


def below(anchor: Word, words: list[Word], predicate: Callable[[str], bool]) -> Word | None:
    # Label columns are read spatially; text order from OCR is not assumed.
    candidates = [
        word
        for word in words
        if (
            word.y >= anchor.bottom - anchor.height * 0.3
            and word.y - anchor.bottom <= anchor.height * 6
            and abs(word.x - anchor.x) <= anchor.height * 2
            and predicate(word.text)
        )
    ]
    if not candidates:
        return None
    return min(
        candidates, key=lambda word: max(0, word.y - anchor.bottom) + abs(word.x - anchor.x) * 1.4
    )


def decimal_text(value: str) -> str | None:
    compact = value.replace(" ", "")
    if not re.fullmatch(r"\d+(?:[.,]\d+)*", compact):
        return None
    if "," in compact:
        compact = compact.replace(".", "").replace(",", ".")
    elif compact.count(".") > 1:
        compact = compact.replace(".", "")
    return compact


def date_text(value: str) -> str | None:
    match = re.fullmatch(r"(\d{2})[/.-](\d{2})[/.-](\d{2}|\d{4})", value)
    if not match:
        return None
    day, month, year = match.groups()
    try:
        return (
            datetime(int(year) if len(year) == 4 else 2000 + int(year), int(month), int(day))
            .date()
            .isoformat()
        )
    except ValueError:
        return None


def valid_sscc(value: str) -> bool:
    if not re.fullmatch(r"\d{18}", value):
        return False
    total = sum(int(digit) * (3 if index % 2 == 0 else 1) for index, digit in enumerate(value[:-1]))
    return (10 - total % 10) % 10 == int(value[-1])


def extract_photo(words: list[Word], raw_text: str, width: int, height: int) -> PhotoAnalysis:
    fields = {name: PhotoField() for name in FIELD_NAMES}
    warnings = ["Sugestões de OCR: revise todos os campos antes de qualquer uso no estoque."]
    rows = rows_of(words)

    def assign(key: str, candidates: list[tuple[str, Word]], method: str) -> None:
        values = {value for value, _ in candidates}
        if len(values) > 1:
            fields[key] = PhotoField(status="ambiguous")
            warnings.append(f"Leituras conflitantes para {key}; preencha manualmente.")
        elif candidates:
            value, word = candidates[0]
            x, y = max(0, min(1, word.x / width)), max(0, min(1, word.y / height))
            fields[key] = PhotoField(
                value=value,
                status="review",
                source_text=word.text,
                method=method,
                ocr_confidence=word.confidence,
                box=Box(
                    x=x,
                    y=y,
                    width=max(0, min(1 - x, (word.right - word.x) / width)),
                    height=max(0, min(1 - y, (word.bottom - word.y) / height)),
                ),
            )

    suppliers = []
    for word in words:
        text = normalized(word.text)
        for name, pattern in (
            ("SCHATTDECOR", "SCHATTDECOR"),
            ("INTERPRINT", "INTERPRINT"),
            ("IMPRESS", "IMPRESS"),
        ):
            if pattern in text:
                suppliers.append((name, word))
    assign("supplier", suppliers, "supplier-text")

    numeric_patterns = {
        "sheets": r"(?:(?:QDE\.?|QTD\.?|QTDE\.?|QUANTIDADE|QUANTITY).*"
        r"(?:FOLHAS|SHEETS|\(PC\)|\(PCS\)).*|QUANT\.?\s*/\s*QUANTITY)",
        "width_mm": r"(?:LARGURA|WIDTH)(?:.*)?",
        "length_mm": r"(?:COMPRIMENTO|LENGTH)(?:.*)?",
        "area_m2": r"(?:TOTAL\s*M[2²]|(?:QUANTIDADE|QUANTITY|QTD\.?).*M[2²].*)",
        "weight_kg": r"(?:PESO\s*\(?KG\)?|PESO\s*LIQUIDO.*|WEIGHT\s*.*)",
        "pallet_number": r"(?:NUM\.?\s*(?:DO\s*)?PALLET|NUMERO\s*(?:DO\s*)?PALLET)",
    }
    for key, pattern in numeric_patterns.items():
        candidates = []
        for anchor in anchors(rows, pattern):
            value_word = below(anchor, words, lambda text: decimal_text(text) is not None)
            if value_word is None:
                continue
            value = decimal_text(value_word.text)
            if value is None:
                continue
            number = float(value)
            if key in ("sheets", "pallet_number"):
                if re.fullmatch(r"\d{1,3}(?:[.,]\d{3})+", value_word.text):
                    number = float(re.sub(r"[.,]", "", value_word.text))
                if not number.is_integer() or not 1 <= number <= 100000:
                    continue
                value = str(int(number))
            elif key in ("width_mm", "length_mm") and not 500 <= number <= 5000:
                continue
            elif not 0 < number <= 100000:
                continue
            candidates.append((value, value_word))
        assign(key, candidates, "label-column")

    # Impress / Interprint often print dimensions in a single size cell.
    dimension_candidates = []
    for row in rows:
        for start in range(len(row)):
            for size in range(1, min(3, len(row) - start) + 1):
                word = span(row[start : start + size])
                match = re.fullmatch(
                    r"(\d{4})\s*[X\u00d7/]\s*(\d{4})(?:\s*MM)?", normalized(word.text)
                )
                if match and all(500 <= int(value) <= 5000 for value in match.groups()):
                    dimension_candidates.append((match.groups(), word))
    if dimension_candidates and not fields["width_mm"].value and not fields["length_mm"].value:
        # Without separate headers, width is the shorter dimension; order is not guessed.
        assign(
            "width_mm",
            [(str(min(map(int, values))), word) for values, word in dimension_candidates],
            "size-pair-short-side",
        )
        assign(
            "length_mm",
            [(str(max(map(int, values))), word) for values, word in dimension_candidates],
            "size-pair-long-side",
        )
        warnings.append("Dimensões sem cabeçalhos individuais: confira largura e comprimento.")

    for key, pattern in (
        ("production_date", r"DATA(?:\s*(?:DE|/))?\s*(?:PROD(?:UCAO|\.)?)(?:.*)?"),
        ("expiry_date", r"(?:DATA\s*(?:DE\s*)?(?:VALIDADE|VALEUR)|VALIDADE)(?:.*)?"),
    ):
        dates = []
        for anchor in anchors(rows, pattern):
            date_word = below(anchor, words, lambda text: date_text(text) is not None)
            if date_word and (date := date_text(date_word.text)):
                dates.append((date, date_word))
        assign(key, dates, "label-column")

    assign(
        "lot",
        [
            (word.text.upper(), word)
            for word in words
            if re.fullmatch(r"D\d{8,10}", word.text.upper())
        ],
        "lot-format",
    )
    pallet_candidates = [
        (word.text, word)
        for word in words
        if re.fullmatch(r"(?:E-\d+/\d+-[A-Z0-9-]+|\d+-\d{4}-[A-Z])", word.text.upper())
    ]
    assign("pallet", pallet_candidates, "pallet-format")
    for key, pattern, value_pattern in (
        ("lot", r"LOTE(?:\s*/\s*BATCH)?|BATCH", r"[A-Z0-9][A-Z0-9/-]{5,30}"),
        (
            "order",
            r"(?:ORDER\s*NUMBER|ORDEM\s*(?:DE\s*)?PRODUCAO|PED\.?\s*CLIENTE)(?:.*)?",
            r"\d+(?:/\d+)?",
        ),
    ):
        if fields[key].value or fields[key].status == "ambiguous":
            continue
        matches = []

        def identifier_matches(text: str, pattern: str = value_pattern) -> bool:
            return re.fullmatch(pattern, text.upper()) is not None

        for anchor in anchors(rows, pattern):
            identifier_word = below(anchor, words, identifier_matches)
            if identifier_word:
                matches.append((identifier_word.text.upper(), identifier_word))
        assign(key, matches, "label-column")

    ssccs = []
    for row in rows:
        for start in range(len(row)):
            for size in range(1, min(4, len(row) - start) + 1):
                word = span(row[start : start + size])
                match = re.fullmatch(r"(?:\(00\))?(\d{18})", word.text.replace(" ", ""))
                if match:
                    if valid_sscc(match[1]):
                        ssccs.append((match[1], word))
                    else:
                        warnings.append("SSCC lido com dígito verificador inválido; não aceito.")
    assign("sscc", ssccs, "printed-sscc-check-digit")

    # Product header, not the client name. Schattdecor's large trade name is preferred.
    material_candidates: list[tuple[str, Word]] = []
    if fields["supplier"].value == "SCHATTDECOR":
        excluded = r"FLORAPLAC|MDF|LTDA|SCHATTDECOR|SUPERIOR|CLIENTE|MADE IN|BRAZIL"
        prominent = []
        for row in rows:
            for start in range(len(row)):
                parts = [row[start]]
                for word in row[start + 1 :]:
                    if word.x - parts[-1].right > word.height * 1.5:
                        break
                    parts.append(word)
                candidate = span(parts)
                if re.fullmatch(
                    r"[A-ZÀ-Ÿ][A-ZÀ-Ÿ\s-]{2,60}", candidate.text.upper()
                ) and not re.search(excluded, normalized(candidate.text)):
                    prominent.append(candidate)
        if prominent:
            prominent.sort(key=lambda word: word.height, reverse=True)
            candidate = prominent[0]
            if candidate.height >= 1.6 * sorted(word.height for word in words)[len(words) // 2]:
                # Join an adjacent second large line, such as BRANCO NÓRDICO / IMP.
                continuation = [
                    word
                    for word in prominent[1:]
                    if (
                        word.y >= candidate.bottom
                        and word.y - candidate.bottom < candidate.height
                        and abs(word.x - candidate.x) < candidate.height
                        and word.height >= candidate.height * 0.7
                    )
                ]
                if continuation:
                    candidate = span([candidate, min(continuation, key=lambda word: word.y)])
                material_candidates.append((candidate.text.strip(), candidate))
    if not material_candidates:
        for anchor in anchors(
            rows,
            r"PRODUTO|DESCRICAO\s*(?:DO\s*)?PRODUTO|"
            r"REFERENCIA\s*DESCRICAO(?:.*)?",
        ):
            material_word = below(
                anchor, words, lambda text: bool(re.search(r"[A-Za-zÀ-ÿ]{3}", text))
            )
            if material_word:
                row = next(row for row in rows if material_word in row)
                start = row.index(material_word)
                parts = [material_word]
                for other in row[start + 1 :]:
                    if other.x - parts[-1].right > material_word.height * 1.5:
                        break
                    parts.append(other)
                candidate = span(parts)
                material_candidates.append((candidate.text.strip(), candidate))
    assign("material", material_candidates, "product-text")

    missing = [key for key in CRITICAL if not fields[key].value]
    if not fields["lot"].value and not fields["pallet"].value:
        missing.append("lot_or_pallet")
    calculated = None
    if all(fields[key].value for key in ("sheets", "width_mm", "length_mm")):
        calculated = round(
            float(fields["sheets"].value or "0")
            * float(fields["width_mm"].value or "0")
            * float(fields["length_mm"].value or "0")
            / 1000000,
            2,
        )
        area = fields["area_m2"].value
        if area and abs(float(area) - calculated) > max(0.05, calculated * 0.005):
            warnings.append("Área declarada diverge de folhas x largura x comprimento; revise.")
    if not words:
        warnings.append("Nenhum texto reconhecido. Tire outra foto ou preencha manualmente.")
    return PhotoAnalysis(
        image_width=width,
        image_height=height,
        fields=fields,
        missing_critical=missing,
        warnings=list(dict.fromkeys(warnings)),
        calculated_area_m2=calculated,
        raw_text=raw_text,
    )
