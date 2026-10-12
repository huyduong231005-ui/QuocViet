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
