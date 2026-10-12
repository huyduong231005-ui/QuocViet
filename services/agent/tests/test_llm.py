import httpx

from extraction import extract_quotation
from llm import OptionalLLM


def test_model_returns_only_grounded_fields_and_counts_usage():
    def handler(request):
        import json
        body = json.loads(request.content)
        assert body["tool_choice"]["function"]["name"] == "extract_quotation"
        assert "untrusted" in body["messages"][0]["content"]
        return httpx.Response(200, json={"usage": {"total_tokens": 25}, "choices": [{"message": {"tool_calls": [{"function": {"name": "extract_quotation", "arguments": json.dumps({"quantity": {"value": 500, "evidence": "invented"}, "qualityScore": {"value": 99, "evidence": "Quality is excellent"}, "approved": {"value": True, "evidence": "approved"}})}}]}}]})
    model = OptionalLLM("key", "http://llm/v1", "model", transport=httpx.MockTransport(handler))
    result = extract_quotation(text="Unit price: 24500 VND\nQuality is excellent", llm=model)
    assert result["quotation"] == {"unitPrice": 24500, "currency": "VND"}
    assert result["tokensUsed"] == 25


def test_optional_llm_failure_keeps_deterministic_draft():
    def handler(request):
        return httpx.Response(503, json={"error": "unavailable"})
    model = OptionalLLM("key", "http://llm/v1", "model", transport=httpx.MockTransport(handler))
    result = extract_quotation(text="Quantity: 10", llm=model)
    assert result["quotation"] == {"quantity": 10}
    assert any("LLM" in item for item in result["warnings"])
    assert result["llmStatus"] == "failed"


def test_inline_quote_fields_are_grounded_and_missing_quality_stays_empty():
    import json
    document = "Báo giá giấy: Số lượng: 15 ram; Đơn giá: 68.000 VND; Giao hàng: 3 ngày; VAT: 8%; Hiệu lực đến: 31/12/2026."
    fields = {
        "quantity": {"value": 15, "evidence": "Số lượng: 15 ram"},
        "unitPrice": {"value": 68000, "evidence": "Đơn giá: 68.000 VND"},
        "deliveryDays": {"value": 3, "evidence": "Giao hàng: 3 ngày"},
        "vat": {"value": 8, "evidence": "VAT: 8%"},
        "validUntil": {"value": "2026-12-31", "evidence": "Hiệu lực đến: 31/12/2026"},
        "currency": {"value": "VND", "evidence": "VND"},
        "qualityScore": None,
    }

    def handler(request):
        body = json.loads(request.content)
        function = body["tools"][0]["function"]
        assert function["strict"] is True
        assert set(function["parameters"]["required"]) == set(fields)
        assert body["parallel_tool_calls"] is False
        return httpx.Response(200, json={"usage": {"total_tokens": 86}, "choices": [{"message": {"tool_calls": [{"function": {"name": "extract_quotation", "arguments": json.dumps(fields)}}]}}]})

    model = OptionalLLM("fixture-key", "http://llm/v1", "fixture-model", transport=httpx.MockTransport(handler))
    try:
        result = extract_quotation(text=document, llm=model)
        assert result["quotation"] == {"quantity": 15, "unitPrice": 68000, "deliveryDays": 3, "vat": 8, "currency": "VND", "validUntil": "2026-12-31"}
        assert result["llmStatus"] == "used"
        assert result["fieldSources"]["quantity"] == "model"
        assert result["evidence"]["unitPrice"] == "Đơn giá: 68.000 VND"
        assert result["missingFields"] == ["qualityScore"]
        assert result["tokensUsed"] == 86
    finally:
        model.close()


def test_model_refusal_and_wrong_evidence_cannot_fill_a_field():
    import json
    for message in [
        {"refusal": "Cannot process"},
        {"tool_calls": [{"function": {"name": "extract_quotation", "arguments": json.dumps({"quantity": {"value": 999, "evidence": "Số lượng: 15 ram"}})}}]},
    ]:
        model = OptionalLLM("fixture-key", "http://llm/v1", "fixture-model", transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"choices": [{"message": message}]})))
        try:
            result = extract_quotation(text="Báo giá: Số lượng: 15 ram", llm=model)
            assert "quantity" not in result["quotation"]
            assert result["warnings"]
        finally:
            model.close()
