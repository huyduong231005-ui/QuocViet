# QuocViet Normalized Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace JSON entity storage with the approved 25-table procurement schema, preserve accounts and API behavior, prove integrity on PostgreSQL 18, then apply to QuocViet before improving the web.

**Architecture:** Typed relational storage in `procurement`, a compatibility Repository for the current camelCase API, versioned atomic migration from retained `legacy_json_v1` data, scoped row locks and a ledger-driven inventory balance. Native runtime verifies schema instead of executing DDL. Embedded PGlite auto-migrates for demos/tests; native schema/roles are explicitly provisioned with a separate administrative command.

**Tech Stack:** TypeScript/NestJS, pg, PostgreSQL 18, PGlite, node:test, existing npm workspaces; no ORM replacement or AI integration.

Approved specification: `C:\Users\ACER\.codex\worktrees\quocviet-database\Quoc_VIet\docs\superpowers\specs\2026-10-11-quocviet-database-design.md`. User approved 11/10/2026 and authorized subsequent web improvements. Scope of this plan remains the database; web work gets a following plan without another general permission request.

Worktree root below is `C:\Users\ACER\.codex\worktrees\quocviet-database\Quoc_VIet`. Live application root is `D:\Quoc_VIet`. Never read secrets into tool output. No production writes during tests. The existing isolated native test cluster at `D:\Quoc_VIet\.data\postgres-setup-tests\cluster`, port 55439, is retained and stopped when testing finishes.

## File boundaries

- `apps/api/migrations/001_core.sql`: tables, FK/CHECK/UNIQUE, indices, immutable records, product/ledger triggers. Schema SQL only; no users, roles or demo data seeded here.
- `apps/api/src/database/contracts.ts`: shared executor, table/entity types and safe conversion helpers.
- `apps/api/src/database/schema.ts`: load versioned SQL, hash migration, expected version.
- `apps/api/src/database/repository.ts`: typed SELECT/UPSERT/DELETE, compatibility maps and targeted queries.
- `apps/api/src/database/legacy.ts`: ordered JSON import, validation and preservation of IDs/bindings/snapshots.
- `apps/api/src/database/migrate.ts`: explicit migration runner, native migration advisory lock, atomic log/checksum verification and rollback.
- `apps/api/src/db.ts`: connection lifecycle, native pool vs PGlite queue, read/write transaction modes, public exports.
- `apps/api/src/procurement.ts`: targeted reads, shared lock protocol, ledger writes, clock-aware expiry.
- `apps/api/src/auth.ts`: email lookup via unique index, read-only authentication.
- `apps/api/src/database/cli.ts`: protected local provisioning, distinct owner/runtime roles, safe target validation; never logs DSNs/secrets.
- `scripts/database.ps1`: UTF-8 BOM PowerShell wrapper for backup/migrate/verify using Node entry point.
- `apps/api/test/database-schema.test.ts`, `database-migration.test.ts`, `database-native.test.ts`: direct SQL integrity, migration fidelity/rollback, native races/runtime permissions.
- `docs/database.md`, `docs/test-report.md`, README: final data dictionary, actual checks/results, operational limitations.

## Task 1: Relational schema and integrity at the SQL boundary

- [x] Write `database-schema.test.ts` with a helper that executes the migration if present and otherwise an empty script; querying information_schema must show all 25 approved tables. Before SQL exists, assert failure on missing relational tables rather than a module-load error.
- [x] Run `npx tsx --test apps/api/test/database-schema.test.ts`; confirm intended missing-schema failure.
- [x] Create `001_core.sql` using the exact table responsibilities in spec sections 3–6. Declare id/created_at on entity tables, unique business identifiers, typed date/time/money, composite lineage FKs, status/gate checks, inventory_balances and inventory_movements. Use no extension-dependent features.
- [x] Give requests/order_lines/receipt_lines real independent IDs and `UNIQUE(parent_id,line_no)` or receipt/order_line uniqueness; never unique parent alone. RFQ belongs to one request line. Each PO line belongs to one unique RFQ/candidate/supplier chain. Store AHP input/result artifacts and typed snapshots, not entire entity JSON.
- [x] Add product INSERT/DELETE triggers for zero balances; ledger INSERT trigger adds balance atomically; prohibit direct mutable ledger/snapshot/audit/agent_steps records. Order-line source/financial terms immutable while receiving counters remain writable.
- [x] Add real direct-SQL fixtures: two lines under one parent, invalid quantity/VAT/currency/status/null, uninvited quotation, mixed-PO receipt line, duplicate RFQ/order/idempotency, ledger mutation, snapshot mutation, and balance reconciliation. Each rejected statement uses savepoints or isolated transaction so later assertions are meaningful.
- [x] Run the schema test and API build. Review spec coverage, then SQL quality/security-definer search_path and grants; fix before commit. Commit only schema/tests.

## Task 2: Repository mappings and versioned atomic migration

- [ ] Write tests for product create/stock projection, request→line→RFQ mapping, invitation roundtrip, AHP immutable artifact/candidate roundtrip, approved PO and receipt projections, audit/Agent compatibility, and reopening a migrated disk database.
- [ ] Implement `contracts.ts`, `repository.ts` with typed columns and parameterized SQL. Current public API remains `list/get/put/remove`; add `find(table, filters)`, `lock(table,id)`, `lockRfq(id)`, `lockOrder(id)`, `setActor(actor)`, `recordReceiptStock(receiptId)`, and SQL aggregate helpers. Filters use a per-table allowlist and special lineage joins; unsupported fields fail explicitly.
- [ ] Helpers map numeric/bigint strings only after checking API safe limits, Date to ISO UTC, month date to YYYY-MM. Preserve absent optional fields (avoid inventing null-valued API fields). New child IDs use randomUUID and are looked up by parent+line_no; updates retain them.
- [ ] `put(products)` creates stock=0 balance via trigger and initial OPENING once if supplied stock>0. Updating product stock to a different value fails; service receipt handling will exclusively call recordReceiptStock. Child receipt inserts do not themselves replay legacy inventory: ledger posting is explicit and idempotent for new receipts only.
- [ ] In the same task, set Repository actor in act transactions and replace the current receipt product-stock put with `recordReceiptStock(receipt.id)`. Keep the existing global native lock until Task 3; this minimal integration must happen before the Task 2 full-suite gate so existing receipt tests still exercise the new ledger successfully.
- [ ] `put(ahp_sessions)` inserts snapshots on initial creation; on lifecycle changes compare immutable input/result/candidates and only update status fields. Guard changes with DB triggers too. `put(orders)` never reconstructs price from current quotations; maps candidate snapshot into immutable PO line, SQL-derived total follows money.ts.
- [ ] Write migration tests with a small legacy JSON database containing admin hash, linked request/RFQ/quotes/session/approval/order/receipt/history and an Agent binding cycle. Capture source records, migrate, and compare all public IDs, important values and inventory totals. OPENING uses current legacy stock, not sum of replayed receipts. Tests include unexpected malformed JSON and forced error rollback.
- [ ] Implement schema loader and migration runner: explicit transaction, native advisory lock only for migration, create/check version log and SHA-256 checksum, execute SQL, ordered import, constraint validation/reconciliation, move the 17 old tables into legacy_json_v1 only after successful import, insert version and commit. Roll back all DDL/data/version changes on failure.
- [ ] Import order: users/products/suppliers/prices; Agent base rows with binding links temporarily absent; requests/lines; RFQs/invitations; quotations; sessions/candidates; approvals; orders/lines; receipts/lines; evaluations/history/audit/outbox/steps; then restore Agent binding links. Deferred FKs or explicit two-pass import preserve cycles. Legacy is never dropped.
- [ ] Native `Database.open(path,url)` checks expected schema+checksum and opens bounded pool without DDL. Explicit `Database.migrate(url)` is used by CLI/tests; embedded open auto-migrates under its queue. Add `transaction(fn,{readOnly,isolation})` with optional REPEATABLE READ, native timeouts, and rollback/release on errors. Initially retain write global lock until Task 3 complete.
- [ ] Run migration tests, npm test and build; adapt only fixtures that relied on mutating AHP snapshots to controlled time before publication. Review compatibility/migration fidelity and code quality; commit the database modules.

## Task 3: Indexed business reads, scoped concurrency and ledger posting

- [ ] Extend tests with a fixed/injectable clock for expiry; show stale quote publication, conflicting approvals and duplicate receipts are protected. Existing AHP algorithms/math remain unchanged.
- [ ] Replace list/filter in write/auth paths with Repository.find using proper indexed columns. Bootstrap uses a read-only consistent snapshot and SQL dashboard/forecast aggregation; it retains full lists for existing UI and explicitly documents that pagination remains future work.
- [ ] Verify actor/receipt-ledger integration introduced in Task 2 covers all write paths and audit only records committed effects. Catalog create stores initial stock through ledger; receipt exclusively posts through recordReceiptStock in the same transaction.
- [ ] Shared locks: gate1/create RFQ lock request before approval; quotation edit/compute/gate2/order lock RFQ, then session, then approval as needed. Compute holds RFQ until snapshot published. Re-read state under lock before each transition. Supplier activity eligibility uses FOR SHARE rows in sorted ID order. PO checks selected candidate only after gate2; gate2 checks at least two valid candidates plus selected candidate.
- [ ] Agent compatibility operations sharing a run take agent_run lock before other business locks; human approval associated with that run uses the same ordering. Agent remains disabled in app. Bound max steps/tokens and existing retry behavior remain.
- [ ] Receipt takes order header, then sorted lines; ledger balance addition is atomic and movements are inserted in globally sorted product ID order (then receipt line ID). This avoids balance deadlocks for independent multi-line orders with opposite line order. Gate2/order financial snapshots cannot mutate. Reverse lock acquisition is prohibited; expose helpers so it is visible in code review.
- [ ] Remove global native advisory lock only after all act/tool paths use these guards. PGlite keeps queue. DomainError messages for unique/FK/check/lock conflicts are safe and user-readable.
- [ ] Run all current tests and build. Spec review checks lock coverage and error semantics, code review checks query allowlists and transaction cleanup; fix then commit.

## Task 4: Native PostgreSQL integration, privilege and query evidence

- [ ] `database-native.test.ts` accepts `TEST_DATABASE_URL` via environment, creates uniquely named isolated databases, migrates explicitly, and always closes pools. With absent URL tests clearly skip; native validation command always supplies it and must report zero skips.
- [ ] Start the retained PostgreSQL18 test cluster with pg_ctl, port55439. Read its password only into Node memory and pass URL via child environment; never put it in command text or logs.
- [ ] Run full procurement workflow on native backend and compare inventory ledger/balance/PO lines. Exercise two different connection pools for simultaneous duplicate-key receipts, overdelivery with different keys, same-product/different-order receipts, conflicting gate decisions, quotation update vs AHP publication, and update vs PO creation.
- [ ] Independent-orders test holds one order row in client A and proves an unrelated order completes in B before A releases it, with bounded timeout; this detects accidental global locking.
- [ ] Create temporary owner/runtime roles and reproduce intended grants. Test stock-zero product create/delete, stock-positive create/receipt, login reads and business operations as runtime. Assert no SUPERUSER/CREATEDB/CREATEROLE/DDL, no UPDATE/DELETE ledger/audit/snapshots, no direct balance writes, no legacy access. Trigger functions have fixed search_path, qualified objects and no callable public privilege.
- [ ] Load a deterministic scale dataset only in a test database; record EXPLAIN (ANALYZE, BUFFERS) for indexed lookup and aggregates. Assert results and absence of full-table application reads, not brittle absolute timing. Keep measurement report sanitized in .data; summarize actual counts/plans in docs.
- [ ] Review test isolation/privilege/concurrency coverage and implementation, run npm test/build and native suite. Commit tests and fixes. Stop retained test cluster at final completion, never delete it.

## Task 5: Protected backup, provision and actual QuocViet cutover

- [ ] Add CLI/wrapper with tests for correct target, credential silence and refusing unsafe/inconsistent migration. Commands load local .env internally with dotenv; URL/passwords never become command-line arguments. Windows PowerShell scripts use UTF-8 BOM and parse on PowerShell5.1.
- [ ] Backup via pg_dump custom format with connection credentials in temporary process environment; restore to an isolated native DB with pg_restore and compare admin hash in memory. Protect backup/config ACL to ACER/SYSTEM/Administrators. Report only path, target metadata and verified counts.
- [ ] Provision an owner NOLOGIN, migrator credential/role and runtime LOGIN. Native runtime gains USAGE + needed table privileges, never owner/DDL. Use administrative postgres connection once; do not alter existing postgres account, PostgreSQL services or other databases. If role names already exist, verify ownership/usage before reuse and never overwrite an unrelated role.
- [ ] Stop only this project's API using existing stop.ps1. Run guarded migration against QuocViet after verifying current database, port5433 and known schema. Keep backup and legacy schema. Set table/function owners/grants; configure runtime URL in local .env using atomic replacement and retain protected previous config.
- [ ] On cutover failure, keep database/config version coherent and preserve logs without secrets. Before any rollback after new API start, lock/stop writes and compare source/target business counts, IDs and audit/ledger markers against the cutover snapshot. Only when no new business transactions exist may a tested administrative rollback transaction move the 17 legacy tables from legacy_json_v1 back to public, restore old config/code, and start the old API. Retain procurement schema, backup and metadata; do not DROP/reset QuocViet. When new transactions exist, refuse rollback to legacy/old dump and perform forward recovery preserving all new records. Test both branches on an isolated native database.
- [ ] Merge reviewed worktree commits into feat/ahp-agent only with a clean live checkout, build and start API. Verify health=ok/demo=false/agent=false, private admin login, 25 typed tables, migrations current, runtime role metadata, no fake business records and no extra accounts. Never print password/hash/JWT.
- [ ] Update README, core-flow/database docs and test-report with actual evidence, ERD/data dictionary, backup/run commands, one-line current API and future multi-line web stage. Verify git diff excludes .env/.data/secrets and clean commit.

## Spec v2 amendments (approved 11/10/2026; override conflicting steps above)

Spec section 12 lists findings R1–R23. `001_core.sql` is not frozen until it is applied to QuocViet, so it is edited in place. Steps above that conflict: Task 2 `recordReceiptStock`, "OPENING uses current legacy stock, not sum of replayed receipts", and every step where the service writes PO counters, PO status or ledger rows.

- [x] Task 1b, schema rework: trigger-owned derived state (`products.opening_stock`/`created_by_user_id`, `post_receipt_line`, order status), state FKs for both gates, one live AHP session per RFQ, append-only and transition-guard triggers including TRUNCATE, product snapshot columns on `order_lines`, `users.active`, caps, drop `revision`, ledger actor limited to user/system. Rewrite the affected direct-SQL tests first (R1–R4, R8, R14, R15, R17, R18).
- [x] Task 2b, repository and legacy import: remove service-side ledger/counter writes; import legacy orders with zero counters and let receipts rebuild them; `opening_stock = stock − accepted receipts`, negative rejects; five reconciliation queries; the 23 pending legacy-semantics tests pass on the new import path (R2, R15). Service side done with it: supersede on request-approval, RFQ closed by trigger, audit `entity_type`, unit and stock caps, inactive accounts (R1, R8 caps, R12 type, R16, R18).
- [x] Fingerprint over the UTC form of the receipt request; retries compare instants (R21).
- [x] Batch child loading with a statement-count test (R6); supplier score, forecast and totals computed once in SQL with null-on-overflow (R7, R8).
- [x] Task 2c, runner: ordered multi-version migrations, per-version checksum verification, `.gitattributes` for SQL line endings, PGlite directory backup before migrating old data (R5).
- [ ] Task 3 additions: conditional status UPDATEs, retry/HTTP mapping for 40P01/40001/55P03, idempotency re-check under the order lock, business-date clock in `Asia/Ho_Chi_Minh` with `businessDate` in bootstrap, SQL-only supplier score and forecast, null-with-flag aggregates, audit catalog before/after, `selfApproved` audit flag (R7–R10, R12, R22, R23).
- [x] Task 4 addition: `database-native.test.ts` (7 tests, run with `npm run test:native`) and a PostgreSQL 18 service in CI (R13).
- [x] Done from Task 3 additions: retry of 40P01/40001 and SQLSTATE-to-HTTP mapping, business-date clock with `businessDate` in bootstrap, audit before/after and `selfApproved`, split monthly spend, read-only transactions outside the write queue (R9 part, R10, R12, R22, R23, R6 part).
- [x] Task 5 core: `npm run db status|backup|migrate`; QuocViet migrated and verified on 11/10/2026 with backup restore and rehearsal. Roles: `npm run db provision` created `quocviet_owner`/`quocviet_app`, moved the administrator URL to `MIGRATION_DATABASE_URL` and switched `.env`; verified by a native test and on the live API. Not done from Task 5: ACL on `.env` and backups, PowerShell wrapper.
- [x] Catalog import from a workbook (`npm run db sample|import`), atomic with preview.

## Following web stage (already authorized; separate design/plan after DB)

Raise the web to a complete Vietnamese procurement workspace: clear empty states and real-mode login, product/supplier data entry, multiple-item requests/PO/receipts, approval inbox, AHP explanation and comparison, inventory movement history, filtering/search, useful exports, account management for five roles, responsive accessible interaction and coherent visual design. Features connect to real persisted APIs and have meaningful tests; no fabricated real data or disabled controls presented as complete. Agent integration follows after the core is accepted.

Keep scope within the original procurement project; no invented accounting/multi-company platform. User's creative authorization covers routine design decisions and local improvements. Do not ask another general confirmation; ask only material business information unavailable from documents/code.

## Progress and final gates

- [x] SQL schema and two-stage review complete (bfaa203; 23 direct SQL tests, API build, spec and quality Approved).
- [ ] Repository/migration and two-stage review complete.
- [ ] Business locks/ledger and two-stage review complete.
- [ ] Native integrity/races/privileges/query evidence complete.
- [ ] Backup restored, QuocViet migrated, real admin verified and empty data preserved.
- [ ] Full build/test reports and code review complete; continue authorized web work.
