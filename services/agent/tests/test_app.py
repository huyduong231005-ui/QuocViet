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
