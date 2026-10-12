"""Quotation extraction. Documents are untrusted data, never workflow commands."""
from __future__ import annotations

import base64
import binascii
import io
import math
import re
import shutil
import subprocess
import tempfile
import unicodedata
from datetime import date
from pathlib import Path
from typing import Any

from pypdf import PdfReader

FIELDS = ("unitPrice", "quantity", "deliveryDays", "qualityScore", "vat", "currency", "validUntil")
MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_TEXT_CHARS = 100_000


def normalized(value: str) -> str:
    return "".join(char for char in unicodedata.normalize("NFKD", value.lower().replace("đ", "d")) if not unicodedata.combining(char))


def parse_number(value: str) -> float:
    value = value.strip().replace(" ", "")
    if "," in value and "." in value:
        decimal = "," if value.rfind(",") > value.rfind(".") else "."
        grouping = "." if decimal == "," else ","
        value = value.replace(grouping, "").replace(decimal, ".")
    elif "," in value or "." in value:
        separator = "," if "," in value else "."
        pieces = value.split(separator)
        if len(pieces) > 2 or (len(pieces[-1]) == 3 and len(pieces[0].lstrip("-")) <= 3):
            value = "".join(pieces)
        else:
            value = value.replace(separator, ".")
    return float(value)


def _ocr_image(blob: bytes) -> tuple[str, list[str]]:
    executable = shutil.which("tesseract")
    if not executable:
        return "", ["OCR unavailable: install Tesseract to extract image or scanned PDF quotations."]
    with tempfile.TemporaryDirectory(prefix="quotation-ocr-") as directory:
        image_path = Path(directory) / "page.png"
        from PIL import Image
        image = Image.open(io.BytesIO(blob))
        if image.width * image.height > 30_000_000:
            raise ValueError("Image exceeds 30 megapixels")
        image.convert("RGB").save(image_path)
        try:
            # Argument list and generated path; document text is never executed.
            process = subprocess.run([executable, str(image_path), "stdout", "-l", "eng", "--psm", "6"], capture_output=True, timeout=45, check=False)
        except (OSError, subprocess.TimeoutExpired):
            return "", ["OCR failed or timed out; review the source manually."]
        if process.returncode:
            return "", ["OCR failed; review the source manually."]
        return process.stdout.decode("utf-8", errors="replace"), ["OCR text may contain recognition errors; verify extracted fields."]


def read_document(text: str | None, file_base64: str | None, mime_type: str | None) -> tuple[str, str, list[str]]:
    warnings: list[str] = []
    extracted = text or ""
    method = "text-regex"
    if file_base64:
        if len(file_base64) > MAX_FILE_BYTES * 1.4:
            raise ValueError("File exceeds 20 MB")
        try:
            blob = base64.b64decode(file_base64, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError("Invalid base64 file payload") from error
        if len(blob) > MAX_FILE_BYTES:
            raise ValueError("File exceeds 20 MB")
        mime_type = (mime_type or "").split(";")[0].lower()
        if mime_type == "application/pdf":
            try:
                reader = PdfReader(io.BytesIO(blob))
                if reader.is_encrypted:
                    raise ValueError("Encrypted PDF is not supported")
                if len(reader.pages) > 20:
                    raise ValueError("PDF exceeds 20 pages")
                embedded = "\n".join(page.extract_text() or "" for page in reader.pages)
            except ValueError:
                raise
            except Exception as error:
                raise ValueError("Invalid PDF file") from error
            if embedded.strip():
                extracted += "\n" + embedded
                method = "pdf-text"
            elif not shutil.which("tesseract"):
                method = "pdf-ocr-unavailable"
                warnings.append("Scanned PDF has no embedded text. OCR unavailable: install Tesseract.")
            else:
                import fitz
                document = fitz.open(stream=blob, filetype="pdf")
                try:
                    for page in document:
                        page_text, page_warnings = _ocr_image(page.get_pixmap(matrix=fitz.Matrix(2, 2)).tobytes("png"))
                        extracted += "\n" + page_text
                        warnings.extend(page_warnings)
                finally:
                    document.close()
                method = "pdf-ocr"
        elif mime_type in {"image/png", "image/jpeg", "image/webp", "image/tiff"}:
            image_text, image_warnings = _ocr_image(blob)
            extracted += "\n" + image_text
            warnings.extend(image_warnings)
            method = "image-ocr" if image_text else "image-ocr-unavailable"
        elif mime_type in {"text/plain", "message/rfc822"}:
            extracted += "\n" + blob.decode("utf-8-sig", errors="replace")
        else:
            raise ValueError("Supported files: PDF, PNG, JPEG, WebP, TIFF, or plain text")
    if len(extracted) > MAX_TEXT_CHARS:
        raise ValueError("Document exceeds 100000 text characters")
    return extracted, method, list(dict.fromkeys(warnings))


def parse_text(text: str) -> dict[str, Any]:
    source = normalized(text)
    draft: dict[str, Any] = {}
    labels = {
        "unitPrice": r"(?:don gia|gia don vi|unit price|price per unit|price)",
        "quantity": r"(?:so luong|quantity|qty)",
        "deliveryDays": r"(?:thoi gian giao hang|giao hang|delivery(?: time)?|lead time|delivery days)",
        "qualityScore": r"(?:diem chat luong|chat luong|quality score|quality rating)",
        "vat": r"(?:thue vat|thue|vat|tax)",
    }
    for field, label in labels.items():
        match = re.search(r"(?:^|\n)\s*" + label + r"\s*[:=\-]?\s*(-?\d[\d., ]*)", source)
        if not match:
            continue
        try:
            value = parse_number(match.group(1))
        except ValueError:
            continue
        if not math.isfinite(value) or value < 0 or (field != "vat" and value <= 0):
            continue
        if field in {"vat", "qualityScore"} and value > 100:
            continue
        if field in {"quantity", "deliveryDays"} and not value.is_integer():
            continue
        draft[field] = int(value) if value.is_integer() else value
    if re.search(r"\bvnd\b|\bdong\b|₫|\bd\b(?=\s*(?:/|$))", source):
        draft["currency"] = "VND"
    match = re.search(r"(?:^|\n)\s*(?:hieu luc den|han bao gia|co gia tri den|valid until|validity|expiry|expiration date)\s*[:=\-]?\s*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{4})", source)
    if match:
        raw = match.group(1)
        try:
            parts = [int(part) for part in re.split(r"[/.-]", raw)]
            year, month, day = parts if len(str(parts[0])) == 4 else (parts[2], parts[1], parts[0])
            draft["validUntil"] = date(year, month, day).isoformat()
        except ValueError:
            pass
    return draft


def extract_quotation(text: str | None = None, file_base64: str | None = None, mime_type: str | None = None, llm=None) -> dict[str, Any]:
    document, method, warnings = read_document(text, file_base64, mime_type)
    draft = parse_text(document)
    tokens = 0
    if llm is not None and document.strip():
        try:
            candidates, tokens = llm.extract(document)
            for field, item in candidates.items():
                if field not in FIELDS or field in draft or not isinstance(item, dict):
                    continue
                evidence = item.get("evidence", "")
                # Only accept independently parsed, verbatim grounded evidence.
                if evidence and evidence in document:
                    grounded = parse_text(evidence)
                    if field in grounded and grounded[field] == item.get("value"):
                        draft[field] = grounded[field]
            method += "+llm-grounded"
        except Exception:
            warnings.append("Optional LLM extraction failed; deterministic extraction remains available.")
    for field in FIELDS:
        if field not in draft:
            warnings.append(f"Missing or invalid field: {field}")
    if not document.strip():
        warnings.append("No readable quotation text found.")
    return {"quotation": draft, "confidence": round(len(draft) / len(FIELDS), 3), "warnings": warnings, "method": method, "tokensUsed": tokens}
