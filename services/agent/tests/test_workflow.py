from collections import Counter

import httpx
import pytest

from workflow import AgentWorkflow, BackendClient, BackendToolError, WorkflowConflict


class BackendFixture:
    """Real httpx transport; the fake represents only the external HTTP boundary."""
    def __init__(self):
        self.run = {"id": "run-1", "productId": "paper", "quantity": 120, "status": "running", "stepCount": 0}
        self.approvals = []
        self.quotations = []
        self.calls = Counter()
        self.failures = {}
        self.failure_status = 503
        self.outputs = {}

    def http(self, request):
        import json
        body = json.loads(request.content)
        assert request.headers["X-Agent-Key"] == "test-key"
        assert body["runId"] == "run-1"
        tool = request.url.path.rsplit("/", 1)[-1]
        self.calls[tool] += 1
        if self.failures.get(tool, 0):
            self.failures[tool] -= 1
            return httpx.Response(self.failure_status, json={"message": "tool refused"})
        if tool == "get_run":
            return httpx.Response(200, json={"run": self.run, "approvals": self.approvals, "quotations": self.quotations})
        if tool in self.outputs:
            return httpx.Response(200, json=self.outputs[tool])
        if tool == "detect_need":
            self.run.update(requestId="request-1", status="waiting_gate1", stage="detection")
            self.approvals.append({"id": "gate-1", "gate": 1, "status": "pending", "runId": "run-1", "requestId": "request-1"})
            result = {"request": {"id": "request-1", "quantity": 120}, "approval": self.approvals[-1]}
        elif tool == "prepare_rfq":
            assert self.approvals[0]["status"] == "approved"
            self.run.update(rfqId="rfq-1", stage="quotations")
            result = {"rfq": {"id": "rfq-1", "requestId": "request-1", "productId": "paper", "quantity": 120}, "request": {"id": "request-1", "quantity": 120}, "product": {"id": "paper", "name": "Giấy A4"}, "suppliers": [{"id": "s1", "name": "An Phát"}, {"id": "s2", "name": "Bình Minh"}], "prices": [{"productId": "paper", "supplierId": "s1", "unitPrice": 24500, "deliveryDays": 3, "qualityScore": 90}, {"productId": "paper", "supplierId": "s2", "unitPrice": 25000, "deliveryDays": 2, "qualityScore": 95}]}
        elif tool == "receive_quotations":
            self.quotations = body["quotations"]
            assert all(q["quantity"] == 120 and q["source"] == "demo" for q in self.quotations)
            result = {"quotations": self.quotations}
        elif tool == "evaluate":
            self.run.update(sessionId="session-1", status="waiting_gate2", stage="proposal")
            self.approvals.append({"id": "gate-2", "gate": 2, "status": "pending", "runId": "run-1", "requestId": "request-1", "rfqId": "rfq-1", "sessionId": "session-1"})
            result = {"session": {"id": "session-1", "cr": 0.01, "consistent": True, "ranking": [{"supplierId": "s1", "score": 0.6}]}, "approval": self.approvals[-1], "proposal": "Tờ trình demo"}
        elif tool == "finalize":
            assert self.approvals[-1]["status"] == "approved"
            self.run.update(orderId="order-1", status="completed", stage="purchase_order")
            result = {"order": {"id": "order-1", "quantity": 120}}
        elif tool == "report_error":
            self.run.update(status="error", error=body["error"])
            return httpx.Response(200, json={"run": self.run})
        else:
            return httpx.Response(404, json={"message": "unknown tool"})
        self.outputs[tool] = result
        return httpx.Response(200, json=result)

    def client(self):
        return BackendClient("http://backend/api", "test-key", transport=httpx.MockTransport(self.http), retry_delay=0)


def test_two_real_interrupts_then_single_po_after_restart(tmp_path):
    backend = BackendFixture()
    path = tmp_path / "checkpoint.sqlite"
    service = AgentWorkflow(backend.client(), sqlite_path=path)
    first = service.start("run-1", "paper", 120)
    assert first["status"] == "waiting_gate1"
    assert first["interrupt"]["gate"] == 1
    assert backend.calls["prepare_rfq"] == 0
    service.close()
    service = AgentWorkflow(backend.client(), sqlite_path=path)
    backend.approvals[0]["status"] = "approved"
    second = service.resume("run-1")
    assert second["status"] == "waiting_gate2"
    assert second["interrupt"]["gate"] == 2
    assert backend.calls["finalize"] == 0
    backend.approvals[1]["status"] = "approved"
    assert service.resume("run-1")["status"] == "completed"
    assert service.resume("run-1")["status"] == "completed"
    assert service.start("run-1", "paper", 120)["status"] == "completed"
    assert backend.calls["detect_need"] == 1
    assert backend.calls["finalize"] == 1
    service.close()


@pytest.mark.parametrize("gate", [1, 2])
def test_rejected_gate_ends_graph_without_purchase_order(tmp_path, gate):
    backend = BackendFixture()
    service = AgentWorkflow(backend.client(), sqlite_path=tmp_path / "checkpoint.sqlite")
    service.start("run-1", "paper", 120)
    if gate == 2:
        backend.approvals[0]["status"] = "approved"
        service.resume("run-1")
    backend.approvals[-1]["status"] = "rejected"
    assert service.resume("run-1")["status"] == "rejected"
    assert backend.calls["finalize"] == 0
    service.close()


def test_pending_or_other_run_approval_cannot_resume(tmp_path):
    backend = BackendFixture()
    service = AgentWorkflow(backend.client(), sqlite_path=tmp_path / "checkpoint.sqlite")
    service.start("run-1", "paper", 120)
    assert service.resume("run-1")["status"] == "waiting_gate1"
    backend.approvals[0].update(status="approved", runId="another-run")
    with pytest.raises(WorkflowConflict, match="approval"):
        service.resume("run-1")
    assert backend.calls["prepare_rfq"] == 0
    service.close()


def test_refused_backend_tool_is_not_retried(tmp_path):
    backend = BackendFixture()
    backend.failures["detect_need"] = 4
    backend.failure_status = 403
    service = AgentWorkflow(backend.client(), sqlite_path=tmp_path / "checkpoint.sqlite")
    with pytest.raises(BackendToolError, match="refused"):
        service.start("run-1", "paper", 120)
    assert backend.calls["detect_need"] == 1
    assert backend.calls["report_error"] == 1
    service.close()


def test_three_failed_attempts_record_error_then_resume_failed_node(tmp_path):
    backend = BackendFixture()
    service = AgentWorkflow(backend.client(), sqlite_path=tmp_path / "checkpoint.sqlite")
    service.start("run-1", "paper", 120)
    backend.approvals[0]["status"] = "approved"
    backend.failures["prepare_rfq"] = 3
    with pytest.raises(BackendToolError):
        service.resume("run-1")
    assert backend.calls["prepare_rfq"] == 3
    assert backend.calls["report_error"] == 1
    assert service.resume("run-1")["status"] == "waiting_gate2"
    assert backend.calls["detect_need"] == 1
    service.close()


def test_real_mode_requires_existing_quotes_and_never_synthesizes(tmp_path):
    backend = BackendFixture()
    service = AgentWorkflow(backend.client(), sqlite_path=tmp_path / "checkpoint.sqlite", demo_mode=False)
    service.start("run-1", "paper", 120)
    backend.approvals[0]["status"] = "approved"
    with pytest.raises(WorkflowConflict, match="2"):
        service.resume("run-1")
    assert backend.calls["receive_quotations"] == 0
    backend.quotations = [{"rfqId": "rfq-1", "supplierId": "s1"}, {"rfqId": "rfq-1", "supplierId": "s2"}]
    assert service.resume("run-1")["status"] == "waiting_gate2"
    assert backend.calls["receive_quotations"] == 0
    service.close()


def test_start_cannot_rebind_existing_run(tmp_path):
    backend = BackendFixture()
    service = AgentWorkflow(backend.client(), sqlite_path=tmp_path / "checkpoint.sqlite")
    with pytest.raises(WorkflowConflict, match="product"):
        service.start("run-1", "wrong-product", 120)
    assert backend.calls["detect_need"] == 0
    service.close()
