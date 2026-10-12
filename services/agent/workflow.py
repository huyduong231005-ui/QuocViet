"""Durable LangGraph workflow; all business writes go through NestJS tools."""
from __future__ import annotations

import os
import sqlite3
import threading
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Any, TypedDict

import httpx
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from extraction import extract_quotation

TOOLS = {"detect_need", "get_run", "prepare_rfq", "receive_quotations", "evaluate", "finalize", "report_error"}


class WorkflowConflict(ValueError):
    pass


class BackendToolError(RuntimeError):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


class BackendClient:
    def __init__(self, base_url: str = "http://127.0.0.1:3000/api", api_key: str = "local-demo-agent-key", *, transport=None, retry_delay: float = 0.2):
        self.client = httpx.Client(base_url=base_url.rstrip("/") + "/", headers={"X-Agent-Key": api_key}, timeout=90, transport=transport)
        self.retry_delay = retry_delay
        self.steps: dict[str, int] = {}

    def begin_budget(self, run_id: str, prior_steps: int):
        self.steps[run_id] = max(self.steps.get(run_id, 0), prior_steps)

    def call(self, tool: str, run_id: str, **payload) -> dict[str, Any]:
        if tool not in TOOLS:
            raise BackendToolError("Agent tool is not allowed", 403)
        for attempt in range(3):
            # report_error is always attempted so failures remain observable.
            if tool != "report_error" and self.steps.get(run_id, 0) >= 30:
                raise BackendToolError("Agent tool limit of 30 steps reached", 409)
            self.steps[run_id] = self.steps.get(run_id, 0) + 1
            try:
                response = self.client.post("agent/tools/" + tool, json={**payload, "runId": run_id}, headers={"Idempotency-Key": f"{run_id}:{tool}"})
            except httpx.TransportError as error:
                if attempt == 2:
                    raise BackendToolError(f"Backend {tool} unavailable after 3 attempts") from error
            else:
                if response.is_success:
                    result = response.json()
                    if not isinstance(result, dict):
                        raise BackendToolError(f"Backend {tool} returned invalid JSON")
                    return result
                try:
                    message = response.json().get("message", "Backend tool refused")
                except (ValueError, AttributeError):
                    message = "Backend tool refused"
                if response.status_code < 500 or attempt == 2:
                    raise BackendToolError(f"{tool}: {message}", response.status_code)
            if self.retry_delay:
                time.sleep(self.retry_delay * (attempt + 1))
        raise BackendToolError("Backend retry exhausted")

    def close(self):
        self.client.close()


class AgentState(TypedDict, total=False):
    runId: str
    productId: str
    quantity: float | None
    requestId: str
    rfqId: str
    sessionId: str
    orderId: str
    status: str
    stage: str
    proposal: str
    session: dict[str, Any]
    tokensUsed: int


class AgentWorkflow:
    def __init__(self, backend: BackendClient, *, sqlite_path: str | Path | None = None, database_url: str | None = None, demo_mode: bool = True, llm=None):
        self.backend = backend
        self.demo_mode = demo_mode
        self.llm = llm
        self.lock = threading.RLock()
        self._postgres_context = None
        self._sqlite_connection = None
        if database_url:
            from langgraph.checkpoint.postgres import PostgresSaver
            self._postgres_context = PostgresSaver.from_conn_string(database_url)
            saver = self._postgres_context.__enter__()
            saver.setup()
        else:
            path = Path(sqlite_path or Path(__file__).resolve().parents[2] / ".data" / "agent.sqlite")
            path.parent.mkdir(parents=True, exist_ok=True)
            self._sqlite_connection = sqlite3.connect(path, check_same_thread=False)
            self._sqlite_connection.execute("PRAGMA journal_mode=WAL")
            saver = SqliteSaver(self._sqlite_connection)
        builder = StateGraph(AgentState)
        builder.add_node("detection", self._detect)
        builder.add_node("gate1", lambda state: self._gate(state, 1))
        builder.add_node("quotations", self._collect)
        builder.add_node("proposal", self._evaluate)
        builder.add_node("gate2", lambda state: self._gate(state, 2))
        builder.add_node("purchase_order", self._finalize)
        builder.add_edge(START, "detection")
        builder.add_edge("detection", "gate1")
        builder.add_conditional_edges("gate1", self._continue, {"continue": "quotations", "stop": END})
        builder.add_edge("quotations", "proposal")
        builder.add_edge("proposal", "gate2")
        builder.add_conditional_edges("gate2", self._continue, {"continue": "purchase_order", "stop": END})
        builder.add_edge("purchase_order", END)
        self.graph = builder.compile(checkpointer=saver)

    @staticmethod
    def _config(run_id: str) -> dict:
        return {"configurable": {"thread_id": run_id}, "recursion_limit": 30}

    def _current(self, run_id: str) -> dict:
        data = self.backend.call("get_run", run_id)
        if data.get("run", {}).get("id") != run_id:
            raise WorkflowConflict("Backend run binding does not match runId")
        return data

    def _detect(self, state: AgentState) -> dict:
        payload = {"productId": state["productId"]}
        if state.get("quantity") is not None:
            payload["quantity"] = state["quantity"]
        result = self.backend.call("detect_need", state["runId"], **payload)
        request = result.get("request")
        run = result.get("run", {})
        request_id = request.get("id") if isinstance(request, dict) else run.get("requestId")
        if not request_id:
            current = self._current(state["runId"])
            request_id = current["run"].get("requestId")
        if not request_id:
            raise WorkflowConflict("Backend did not bind a purchase request")
        return {"requestId": request_id, "status": "waiting_gate1", "stage": "detection"}

    def _approval(self, state: dict, data: dict, gate: int) -> dict:
        run = data["run"]
        for field in ("productId", "requestId", "rfqId", "sessionId"):
            if state.get(field) and run.get(field) != state[field]:
                raise WorkflowConflict(f"Backend {field} binding changed")
        candidates = [approval for approval in data.get("approvals", []) if approval.get("gate") == gate
                      and approval.get("runId") == state["runId"]
                      and approval.get("requestId") == state.get("requestId")
                      and (gate == 1 or (approval.get("rfqId") == state.get("rfqId") and approval.get("sessionId") == state.get("sessionId")))]
        if not candidates:
            raise WorkflowConflict("No matching backend approval for this run and gate")
        # Gate2 revisions may cancel older approvals; use the latest matching gate.
        return candidates[-1]

    def _gate(self, state: AgentState, gate: int) -> dict:
        interrupt({"gate": gate, "runId": state["runId"], "requestId": state.get("requestId"), "sessionId": state.get("sessionId"), "message": "Waiting for backend approval"})
        # Ignore the resume value. Only the backend can authorize continuation.
        decision = self._approval(state, self._current(state["runId"]), gate)
        if decision.get("status") == "rejected":
            return {"status": "rejected"}
        if decision.get("status") != "approved":
            raise WorkflowConflict("Backend approval is pending or cancelled")
        return {"status": "running"}

    @staticmethod
    def _continue(state: AgentState) -> str:
        return "stop" if state.get("status") == "rejected" else "continue"

    def _collect(self, state: AgentState) -> dict:
        result = self.backend.call("prepare_rfq", state["runId"])
        rfq = result["rfq"]
        if rfq.get("requestId") != state["requestId"] or rfq.get("productId") != state["productId"]:
            raise WorkflowConflict("RFQ does not match the run request/product")
        if self.demo_mode:
            quotations = []
            tokens = 0
            valid_until = (date.today() + timedelta(days=30)).isoformat()
            for supplier in result.get("suppliers", []):
                price = next((price for price in result.get("prices", []) if price.get("supplierId") == supplier["id"] and price.get("productId") == state["productId"]), None)
                if price is None:
                    continue
                text = (f"BÁO GIÁ DEMO: {result.get('product', {}).get('name', '')}\n"
                        f"Số lượng: {rfq['quantity']}\nĐơn giá: {price['unitPrice']} VND\n"
                        f"Thời gian giao hàng: {price['deliveryDays']} ngày\nVAT: 10%\nHiệu lực đến: {valid_until}")
                parsed = extract_quotation(text=text, llm=self.llm)
                tokens += parsed["tokensUsed"]
                quotation = parsed["quotation"]
                quotation["qualityScore"] = price["qualityScore"]
                quotation.update(rfqId=rfq["id"], supplierId=supplier["id"], source="demo")
                quotations.append(quotation)
            if len(quotations) < 2:
                raise WorkflowConflict("Demo needs at least 2 suppliers with configured prices")
            self.backend.call("receive_quotations", state["runId"], rfqId=rfq["id"], quotations=quotations, tokensUsed=tokens, usageId=state["runId"] + ":extraction")
        else:
            quotations = result.get("quotations", self._current(state["runId"]).get("quotations", []))
            matching = {quote.get("supplierId") for quote in quotations if quote.get("rfqId") == rfq["id"]}
            matching.discard(None)
            if len(matching) < 2:
                raise WorkflowConflict("Real mode requires at least 2 existing supplier quotations for this RFQ")
        return {"rfqId": rfq["id"], "stage": "quotations", "status": "running"}

    def _evaluate(self, state: AgentState) -> dict:
        result = self.backend.call("evaluate", state["runId"], rfqId=state["rfqId"], tokensUsed=0, usageId=state["runId"] + ":ahp")
        session = result["session"]
        proposal = result.get("proposal", "")
        if self.llm:
            try:
                proposal, tokens = self.llm.proposal({"session": session, "quantity": state.get("quantity"), "source": "demo" if self.demo_mode else "real", "backendProposal": proposal})
                self.backend.call("evaluate", state["runId"], rfqId=state["rfqId"], proposal=proposal, tokensUsed=tokens, usageId=state["runId"] + ":proposal")
            except (BackendToolError, WorkflowConflict):
                raise
            except Exception:
                # A factual backend proposal is always available without a model.
                proposal = result.get("proposal", "")
        return {"sessionId": session["id"], "session": session, "proposal": proposal, "stage": "proposal", "status": "waiting_gate2"}

    def _finalize(self, state: AgentState) -> dict:
        result = self.backend.call("finalize", state["runId"], sessionId=state["sessionId"])
        return {"orderId": result["order"]["id"], "stage": "purchase_order", "status": "completed"}

    def _snapshot_result(self, run_id: str) -> dict:
        snapshot = self.graph.get_state(self._config(run_id))
        result = dict(snapshot.values)
        pending = [item for task in snapshot.tasks for item in task.interrupts]
        if pending:
            result["interrupt"] = pending[0].value
            result["status"] = f"waiting_gate{pending[0].value['gate']}"
        return result

    def _execute(self, run_id: str, input_value) -> dict:
        try:
            self.graph.invoke(input_value, self._config(run_id))
        except Exception as error:
            try:
                self.backend.call("report_error", run_id, error=str(error)[:1000])
            except Exception:
                pass
            raise
        return self._snapshot_result(run_id)

    def start(self, run_id: str, product_id: str, quantity: float | None = None) -> dict:
        with self.lock:
            data = self._current(run_id)
            run = data["run"]
            self.backend.begin_budget(run_id, run.get("stepCount", 0))
            if run.get("productId") != product_id:
                raise WorkflowConflict("Requested product does not match backend run")
            if quantity is not None and run.get("quantity") is not None and quantity != run["quantity"]:
                raise WorkflowConflict("Requested quantity does not match backend run")
            snapshot = self.graph.get_state(self._config(run_id))
            if snapshot.values:
                existing = self._snapshot_result(run_id)
                if existing.get("interrupt") or not snapshot.next:
                    return existing
                return self._execute(run_id, None)
            return self._execute(run_id, {"runId": run_id, "productId": product_id, "quantity": quantity if quantity is not None else run.get("quantity"), "tokensUsed": 0})

    def resume(self, run_id: str) -> dict:
        with self.lock:
            data = self._current(run_id)
            self.backend.begin_budget(run_id, data["run"].get("stepCount", 0))
            snapshot = self.graph.get_state(self._config(run_id))
            if not snapshot.values:
                # Lost checkpoint recovery replays idempotent tools from backend bindings.
                return self.start(run_id, data["run"]["productId"], data["run"].get("quantity"))
            existing = self._snapshot_result(run_id)
            if not snapshot.next:
                return existing
            if existing.get("interrupt"):
                gate = existing["interrupt"]["gate"]
                decision = self._approval(existing, data, gate)
                if decision.get("status") == "pending":
                    return existing
                if decision.get("status") not in {"approved", "rejected"}:
                    raise WorkflowConflict("Backend approval cancelled; recalculate and approve a current session")
                return self._execute(run_id, Command(resume="recheck-backend"))
            return self._execute(run_id, None)

    def close(self):
        self.backend.close()
        if self._sqlite_connection:
            self._sqlite_connection.close()
        if self._postgres_context:
            self._postgres_context.__exit__(None, None, None)
