import json

import httpx
from fastapi.testclient import TestClient

from app import create_app
from extraction import extract_quotation
from llm import GeminiLLM, model_from_environment


DOCUMENT = "Số lượng: 15 ram\nĐơn giá: 68.000 VND\nGiao hàng: 3 ngày\nVAT: 8%\nHiệu lực đến: 31/12/2099"
GROUNDED = {
    "unitPrice": {"value": 68000, "evidence": "Đơn giá: 68.000 VND"},
    "quantity": {"value": 15, "evidence": "Số lượng: 15 ram"},
    "deliveryDays": {"value": 3, "evidence": "Giao hàng: 3 ngày"},
    "qualityScore": None,
    "vat": {"value": 8, "evidence": "VAT: 8%"},
    "currency": {"value": "VND", "evidence": "VND"},
    "validUntil": {"value": "2099-12-31", "evidence": "Hiệu lực đến: 31/12/2099"},
}


def gemini_response(fields=GROUNDED):
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(fields)}]}}],
                                     "usageMetadata": {"totalTokenCount": 73}})


def test_gemini_rotates_keys_and_uses_structured_json():
    seen = []

    def handler(request):
        seen.append(request.headers["x-goog-api-key"])
        assert request.url.path.endswith("/models/gemini-3.5-flash-lite:generateContent")
        body = json.loads(request.content)
        assert body["contents"][0]["parts"][0]["text"] == DOCUMENT
        assert body["generationConfig"]["responseFormat"]["text"]["mimeType"] == "application/json"
        assert set(body["generationConfig"]["responseFormat"]["text"]["schema"]["required"]) == set(GROUNDED)
        assert "untrusted" in body["systemInstruction"]["parts"][0]["text"]
        return gemini_response()

    model = GeminiLLM(["key-one", "key-two"], transport=httpx.MockTransport(handler))
    try:
        for _ in range(3):
            result = extract_quotation(text=DOCUMENT, llm=model)
            assert result["llmStatus"] == "used"
            assert result["tokensUsed"] == 73
            assert result["quotation"]["unitPrice"] == 68000
            assert "qualityScore" in result["missingFields"]
        assert seen == ["key-one", "key-two", "key-one"]
    finally:
        model.close()


def test_gemini_uses_next_key_on_429_and_keeps_grounding():
    seen = []

    def handler(request):
        seen.append(request.headers["x-goog-api-key"])
        if len(seen) == 1:
            return httpx.Response(429, json={"error": {"message": "quota"}})
        fields = {**GROUNDED, "qualityScore": {"value": 99, "evidence": "invented"}}
        return gemini_response(fields)

    model = GeminiLLM(["key-one", "key-two"], transport=httpx.MockTransport(handler))
    try:
        result = extract_quotation(text=DOCUMENT, llm=model)
        assert seen == ["key-one", "key-two"]
        assert result["llmStatus"] == "used"
        assert "qualityScore" not in result["quotation"]
        assert result["warnings"]
    finally:
        model.close()


def test_all_keys_limited_reports_limit_and_preserves_regex_draft():
    seen = []

    def handler(request):
        seen.append(request.headers["x-goog-api-key"])
        return httpx.Response(429, json={"error": {"message": "quota"}})

    model = GeminiLLM(["key-one", "key-two"], transport=httpx.MockTransport(handler))
    try:
        result = extract_quotation(text=DOCUMENT, llm=model)
        assert seen == ["key-one", "key-two"]
        assert result["llmStatus"] == "rate_limited"
        assert result["quotation"]["quantity"] == 15
        assert any("rate limit" in warning for warning in result["warnings"])
    finally:
        model.close()


def test_gemini_provider_ignores_existing_openai_key_when_no_gemini_key(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.setenv("LLM_API_KEY", "unused-openai-key")
    monkeypatch.delenv("GEMINI_API_KEYS", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    assert model_from_environment() is None
    monkeypatch.setenv("AGENT_API_KEY", "agent-fixture")
    monkeypatch.setenv("AGENT_ENABLED", "false")
    with TestClient(create_app()) as client:
        health = client.get("/health").json()
        assert health["llmConfigured"] is False
        assert health["provider"] == "gemini"
        assert health["keyCount"] == 0
        result = client.post("/extract", headers={"X-Agent-Key": "agent-fixture"}, json={"text": DOCUMENT})
        assert result.status_code == 200
        assert result.json()["llmStatus"] == "not_configured"
