from fastapi.testclient import TestClient

from app import create_app
from test_workflow import BackendFixture
from workflow import AgentWorkflow


def test_health_public_extraction_and_runs_require_agent_key(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_KEY", "test-key")
    service = AgentWorkflow(BackendFixture().client(), sqlite_path=tmp_path / "checkpoint.sqlite")
    with TestClient(create_app(service)) as client:
        assert client.get("/health").status_code == 200
        assert client.post("/extract", json={"text": "Quantity: 10"}).status_code == 401
        assert client.post("/runs/start", json={"runId": "run-1", "productId": "paper"}).status_code == 401
        result = client.post("/extract", headers={"X-Agent-Key": "test-key"}, json={"text": "Quantity: 10"})
        assert result.status_code == 200
        assert result.json()["quotation"] == {"quantity": 10}
        assert result.json()["warnings"]


def test_resume_cannot_accept_user_approved_flag(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_KEY", "test-key")
    service = AgentWorkflow(BackendFixture().client(), sqlite_path=tmp_path / "checkpoint.sqlite")
    with TestClient(create_app(service)) as client:
        result = client.post("/runs/resume", headers={"X-Agent-Key": "test-key"}, json={"runId": "run-1", "approved": True})
        assert result.status_code == 422
        assert "message" in result.json()


def test_invalid_payload_has_consistent_error_shape(tmp_path, monkeypatch):
    monkeypatch.setenv("AGENT_API_KEY", "test-key")
    service = AgentWorkflow(BackendFixture().client(), sqlite_path=tmp_path / "checkpoint.sqlite")
    with TestClient(create_app(service)) as client:
        response = client.post("/extract", headers={"X-Agent-Key": "test-key"}, json={"fileBase64": "@@@", "mimeType": "application/pdf"})
        assert response.status_code == 400
        assert response.json()["statusCode"] == 400


def test_extraction_only_service_does_not_initialize_the_workflow_or_database(monkeypatch):
    monkeypatch.setenv("AGENT_API_KEY", "test-key")
    monkeypatch.setenv("AGENT_ENABLED", "false")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    # The application's DB URL must never become the Agent's checkpoint DB.
    monkeypatch.setenv("DATABASE_URL", "postgresql://must-not-connect/production")
    with TestClient(create_app()) as client:
        health = client.get("/health").json()
        assert health["workflowEnabled"] is False
        assert health["llmConfigured"] is False
        headers = {"X-Agent-Key": "test-key"}
        response = client.post("/extract", headers=headers, json={"text": "Quantity: 15"})
        assert response.status_code == 200
        assert response.json()["llmStatus"] == "not_configured"
        assert response.json()["quotation"] == {"quantity": 15}
        assert client.post("/runs/start", headers=headers, json={"runId": "run-1", "productId": "paper"}).status_code == 403


def test_gemini_config_requires_agent_key_and_persists_without_echoing_keys(tmp_path, monkeypatch):
    config = tmp_path / ".env"
    config.write_text("DATABASE_URL=postgres://fixture:secret@localhost/demo\nLLM_PROVIDER=gemini\n", encoding="utf-8")
    monkeypatch.setenv("AGENT_CONFIG_FILE", str(config))
    monkeypatch.setenv("AGENT_API_KEY", "internal-fixture")
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.setenv("AGENT_ENABLED", "false")
    monkeypatch.delenv("GEMINI_API_KEYS", raising=False)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    body = {"keys": ["AQ.example=one", "AQ+example/two"], "model": "gemini-3.5-flash-lite"}
    with TestClient(create_app()) as client:
        assert client.post("/config/gemini", json=body).status_code == 401
        invalid = client.post("/config/gemini", headers={"X-Agent-Key": "internal-fixture"}, json={"keys": ["bad key"]})
        assert invalid.status_code == 400
        assert "bad key" not in invalid.text
        response = client.post("/config/gemini", headers={"X-Agent-Key": "internal-fixture"}, json=body)
        assert response.status_code == 200
        assert response.json() == {"configured": True, "provider": "gemini", "model": "gemini-3.5-flash-lite", "keyCount": 2}
        assert not any(key in response.text for key in body["keys"])
        health = client.get("/health").json()
        assert health["llmConfigured"] is True
        assert health["keyCount"] == 2
        assert not any(key in str(health) for key in body["keys"])
    saved = config.read_text(encoding="utf-8")
    assert "DATABASE_URL=postgres://fixture:secret@localhost/demo" in saved
    assert "GEMINI_API_KEYS=AQ.example=one,AQ+example/two" in saved


def test_draft_email_endpoint_returns_template_or_ai(monkeypatch):
    monkeypatch.setenv("AGENT_API_KEY", "test-key")
    monkeypatch.setenv("AGENT_ENABLED", "false")
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    with TestClient(create_app()) as client:
        headers = {"X-Agent-Key": "test-key"}
        res = client.post("/draft-email", headers=headers, json={"type": "rfq", "supplierName": "An Phát", "productName": "Giấy A4", "quantity": 10, "unit": "ram"})
        assert res.status_code == 200
        data = res.json()
        assert "subject" in data and "body" in data
        assert "Thư mời" in data["subject"] and "An Phát" in data["subject"]
        assert "An Phát" in data["body"]
        assert data["source"] == "template"

