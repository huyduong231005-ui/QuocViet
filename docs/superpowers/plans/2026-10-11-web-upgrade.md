# QuocViet web completion plan

> Use superpowers:subagent-driven-development for sequential implementation with spec and quality review. This follows the approved database plan; do not start web code before database cutover is verified.

**Goal:** Deliver a coherent Vietnamese procurement workspace with real accounts, multiple-item documents, usable inventory/history and reports. Agent remains a later stage. Office stationery/consumables are reference examples, not production seed data.

**Architecture:** Keep NestJS, React/Ant Design and the normalized PostgreSQL repository. Add versioned migrations for new account/evaluation fields; preserve existing one-item API inputs and AHP algorithms. New UI uses item arrays and server-side filtered lists. Validate authorization and state transitions on the server, with transaction locks inherited from the database work.

Design: `docs/superpowers/specs/2026-10-11-web-upgrade-design.md`. User already authorized creative local improvements. Worktree: `C:\Users\ACER\.codex\worktrees\quocviet-database\Quoc_VIet`. Live: `D:\Quoc_VIet`. Never seed business data or extra test accounts into live QuocViet.

## W1 — Real accounts and session lifecycle

Status 11/10/2026 (branch `feat/normalized-db-v2`): done without a new migration. `users.active` already exists in `001_core.sql`, and sessions are tied to the stored password hash through a digest carried in the token, so no credential-version column was needed. Implemented: `accounts.ts` (list/create/update/reset, own password change, last-administrator and self-lockout guards, audit without secrets), routes under `/api/accounts` and `/api/auth/password`, the Accounts page, a change-password dialog, and a login page that shows demo shortcuts only when the server reports demo mode. Tests: `apps/api/test/accounts.test.ts`; the page was checked in a browser against the live API. Not done: a shared lock for concurrent administrator edits (writes are still globally serialized, which covers it for now).

Files: next account SQL migration, database schema loader/repository user mapping, `accounts.ts`, `auth.ts`, controller/app routes, account/API tests.

- [ ] Add active flag and credential/session version through a new migration. Existing users remain active and retain exact hashes.
- [ ] Register migration checksum/version and update native expected-version checks. Maintain owner/runtime grants for new columns/objects; test upgrade from the completed DB baseline and verify the restricted runtime can use the new account fields without DDL privileges.
- [ ] Implement admin-only list/create/update/disable/reset-password operations. Responses expose only public user fields. Validate all five roles, normalized email uniqueness and password rules; hash with existing scrypt.
- [ ] Lock account-management changes with a shared account administration lock so two concurrent edits cannot remove the last active admin. Protect self/last-admin operations with useful messages.
- [ ] JWT verifies current active status, role and credential version on each request; disable, role change and password reset invalidate existing sessions.
- [ ] Audit account changes without password/hash/token details. Add explicit access tests for all roles, last-admin concurrent changes and session invalidation. Run API tests/build and migration/native regression gates, review, commit.

## W2 — Multiple-item business workflow

Status 11/10/2026: backend and UI done. Requests take 1–50 lines; RFQs are per line; a PO groups approved sessions of one supplier; receipts cover any subset of lines with order-independent retries; multi-line evaluation weighs lines by pre-VAT ordered value; migration `002_multi_line_evaluation.sql` is applied to QuocViet. Tests: `apps/api/test/multi-line.test.ts`, web `tests/logic.test.ts`; request dialog, grouped PO and a partial two-line receipt were exercised in a browser on the live system. Not done from this section: the scoped lock order for multi-line POs (writes are still globally serialized), a native two-pool deadlock test for opposite line orders, and stored per-line evaluation inputs (only the resulting scores are stored).

Files: `validation.ts`, `procurement.ts`, repository item mappings, next evaluation SQL migration, procurement/API/native tests.

- [ ] Requests accept 1–50 unique-product items in one transaction. Gate1 covers the entire request. Keep old productId/quantity input for one item; return child IDs and items, with old flat fields only for one-item documents.
- [ ] RFQ accepts requestLineId and keeps one RFQ per requested line. Legacy requestId-only input works only when unambiguous. Keep independent per-product quotes and AHP snapshots; re-use existing eligibility and clock checks.
- [ ] PO accepts sessionIds for 1–50 approved sessions, same supplier, unique RFQ lines and valid selected snapshots. Acquire all run IDs first, then all RFQ IDs, then sessions, approvals and suppliers, sorting IDs within each category; never acquire the whole chain separately for each line. A failed line rolls back the whole document. Total sums exact rounded line totals and checks safe money bounds.
- [ ] Receipts accept items referencing orderLineId, with quantity and acceptedQuantity. Verify membership/remaining quantities for every line under order and sorted-line locks. Canonicalize item ordering and payload fields before idempotency hashing; preserve one-item compatibility. Post only accepted quantities to the ledger, ordered globally by productId (then receiptLineId for repeated products), so opposite PO-line orders cannot deadlock on balance rows. Rejected units never increase stock.
- [ ] Order status derives from all lines; UI/API avoid summing unlike physical units. Outbox text lists product names, units and individual terms; pending email remains visibly pending until a real provider exists.
- [ ] Evaluation after full receipt: single-item formula unchanged; multi-item acceptance weighted by each line's pre-tax ordered value. Define zero/precision handling, score per-line delivery from receipts and agreed due dates, store inputs/summary sufficient to explain results. Add versioned fields if needed, never overwrite applied migrations.
- [ ] New migration makes evaluations.product_id nullable for multi-line PO; single-line evaluations retain it. Register version/checksum and update expected-version and role grants. Test different VAT, different delivery promises, partial receipts, 87.5% value-weighted acceptance and equivalence to the old one-line formula, with explicit score rounding precision.
- [ ] Test two products with different units through both gates, grouped PO, partial and rejected receipt, reordered retry, cross-PO/duplicate/missing lines, rollback and concurrent over-receipt. A native two-pool test receives shared products from two POs whose line IDs imply opposite product order; both succeed and balances reconcile without deadlock. Re-run old single-item and native tests, review, commit.

## W3 — Filtered lists, detail and stock history API

Status 11/10/2026: done for the two lists that only ever grow. `GET /api/audit` and `GET /api/inventory/movements` page, search and filter in SQL (page size 1–100, stable newest-first order, literal search text, date range in the business timezone for audit; product and kind for the ledger). The web bootstrap no longer carries either list; the Audit page and the stock movements tab use a shared `PagedTable`. Tests: `apps/api/test/paging.test.ts`; both screens were checked in a browser on the live system. Documents followed the same day: `GET /api/list/:kind` pages requests, RFQs, quotations, approvals, orders, receipts and evaluations, and the web bootstrap now returns a working set only (master data, documents still in progress, and documents of the last `WORKSPACE_DAYS`, default 90). The Procurement, Orders and Approvals screens read the paged lists; a row carries what it needs to be shown without the rest of its chain. Decision taken here, different from the original W3 text: the catalog (products, suppliers, prices) stays whole in bootstrap, because it is bounded master data that every selector needs. `EXPLAIN (ANALYZE)` on PostgreSQL 18 with 200,000 audit rows and 50,000 requests: audit first page 0.06 ms and audit by entity type 0.04 ms (index `audit_created`), audit page 1000 1.8 ms, pending requests 0.08 ms (index `requests_status_created`), lines of one page 0.05 ms; three queries read the whole table and were left without an index at this size: audit text search 83 ms, unfiltered request list 8 ms, working-set requests 6 ms. Not done: the AHP screen lists only RFQs in the working set, so the ranking table of an RFQ closed more than 90 days ago is reachable only through its approval's proposal text.

Files: repository query helpers, read service/controller endpoints, API tests, bootstrap contract/types.

- [ ] Add allowlisted list endpoints with search/status/date filters, page/pageSize bounds, stable ordering and total count for catalog, requests, approvals, orders, receipts and audit. Parameterize values and constrain identifiers; never return user credentials.
- [ ] Detail endpoints return full document items and related workflow context. Provide bounded reference/selection queries; avoid fetching every document merely to show a selector. Inventory movement reads include document/product/unit and public actor names.
- [ ] Move page tables to these endpoints in W4/W5. Keep bootstrap compatibility for existing clients but document any retained full-list cost. New workspace loading requests summary and required reference data; do not silently truncate workflow options or hide pending approvals.
- [ ] Test filters/counts/ordering, pagination across equal timestamps, permission denial and ledger reconciliation. Use native EXPLAIN evidence for important lookups; review, commit.

## W4 — Workspace, login, catalog and accounts UI

Files: `App.tsx`, `api.tsx`, `types.ts`, `styles.css`, shared components, Catalog/Dashboard, new Accounts page, web tests.

- [ ] Apply frontend-skill app guidance: navy navigation, teal actions, calm surfaces and clear hierarchy. Provide responsive collapsed navigation, visible keyboard focus, loading/error/empty states and reduced motion. Utility copy only.
- [ ] Obtain real demoMode from unauthenticated health/config. Real login has no demo-prefilled credentials; demo mode labels and shortcuts only when actually enabled. Session expiration/lock returns the user to login with a useful message.
- [ ] Dashboard uses real summary values and next actions; empty QuocViet guides catalog entry. Explain forecast fallback and inventory valuation source. Avoid synthetic-history claims in real mode.
- [ ] Catalog uses server search/filter/page controls, good form labels, explicit stock-opening input and immutable stock after create. Link to inventory history. Show errors adjacent to relevant fields where possible.
- [ ] Admin accounts page connects to W1, showing role/activity, creating accounts and resetting credentials safely. Never place passwords in URL/storage/table/toasts.
- [ ] Test permissions, login-mode behavior, input/action helpers and meaningful rendering states. Browser-check desktop/mobile plus keyboard; review, commit.

## W5 — Procurement, AHP, approvals, PO and receiving UI

Files: Procurement/Ahp/Approvals/Orders/Inventory/Audit pages, document drawer/shared item editor, web logic/tests.

- [ ] Multiple-item request editor with clear product/unit/quantity rows and row-specific validation. Show every line in approvals and request details; select a particular line to create its RFQ.
- [ ] Quote entry/edit shows invited suppliers, expiry, required quantity and missing responses. AHP explains CR, ranking, snapshot and Monte Carlo limits; changing inputs creates a new immutable session. Gate2 supports selecting another supplier with required explanation.
- [ ] Group approved sessions by selected supplier for PO creation. Tables show item count, total and per-line progress. Document drawer lists product/unit/quantity/price/VAT/line total, source approval and statuses.
- [ ] Multi-line receipt editor shows remaining quantities, delivered and accepted values; retains one retry key until success or content is intentionally changed. Prevent accidental repeated submission, preserve values on errors and show posted receipt result.
- [ ] Inventory shows persisted balance/movements and honest forecast source. Evaluation shows the defined acceptance/delivery method and resulting scores. Audit supports server filters and navigation to matching documents.
- [ ] Verify role-specific actions, full two-product flow, stale/expired states, retry, loading/errors/empty states and mobile form access. Review, commit.

## W6 — Vietnamese reports and operational documentation

Status 11/10/2026: Excel and PDF now use product and supplier names, units, PO numbers, one row per PO line and per received line, Vietnamese status labels, and formula-safe cells (`apps/api/test/reports.test.ts`; the PDF was opened and read). Catalog import with preview and atomic commit is available from the CLI and from the Catalog page ("Nhập từ Excel", with a template download); both the rejection of a duplicate file and a successful import were exercised in a browser on the live system. Not done: report filters and scope header, repeated page headings.

Files: `reports.ts`, report tests, frontend download controls, README/docs.

- [ ] Excel/PDF include product and supplier names, document references, units, individual lines, VAT and exact totals. Include report timestamp/scope, stage/status labels, filters and scoring explanations. Format amounts/dates and repeat page headings where useful.
- [ ] Add catalog CSV/template download with UTF-8 Vietnamese-compatible encoding, quoted fields, column instructions and formula-prefix protection; connect the actual endpoint in Catalog. A template is not an import feature; do not expose an import button unless preview, validation and atomic commit are implemented.
- [ ] Escape spreadsheet formula-like strings in exported untrusted names/notes; exclude credentials and sensitive audit payloads. Exports respect authenticated role/read access.
- [ ] Test workbook cell values/line counts/totals and PDF text/layout with Unicode Vietnamese. Inspect rendered PDF pages before claiming report layout complete.
- [ ] Document real startup, account access, data entry sequence, backups, rollback limits and deferred Agent/email. Remove misleading demo-production wording. Review, commit.

## W7 — Final integration and live handoff

- [ ] Run full unit/API/schema/migration/native concurrency/privilege suite and build once after final changes. Resolve actual failures before broadening tests.
- [ ] Run isolated browser workflow on a test database: all roles, at least two differently measured products, approvals/AHP/grouped PO/partial receipt/evaluation/export. Capture desktop/mobile evidence without passwords/tokens.
- [ ] Use protected backup and verified migration procedure for added migrations on live QuocViet, retaining admin credentials/data. Merge only reviewed commits into clean live checkout, build/restart only this application.
- [ ] Verify health, real-mode login, current schema/runtime role, retained admin and empty business database. Do not fill live database with the workflow fixture. Stop retained native test cluster after testing; keep its files.
- [ ] Final independent code review and concise Vietnamese handoff with actual passing checks, usable local URL and any remaining material limitations. No claim of public deployment, real email delivery or Agent readiness.
