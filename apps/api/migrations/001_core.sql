-- Core DDL only. The migration runner supplies the transaction, checksum and
-- version row. Provisioning owners/runtime roles and transferring legacy data
-- are separate operations; this file creates no roles, extensions or seed rows.
CREATE SCHEMA procurement;

CREATE TABLE procurement.users (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 500),
  email text NOT NULL CHECK (char_length(email) BETWEEN 1 AND 254),
  role text NOT NULL CHECK (role IN ('admin','buyer','manager','warehouse','auditor')),
  password_hash text NOT NULL CHECK (char_length(password_hash) > 0),
  demo boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE UNIQUE INDEX users_email_unique ON procurement.users (lower(email));

CREATE TABLE procurement.products (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  sku text NOT NULL UNIQUE CHECK (char_length(btrim(sku)) BETWEEN 1 AND 500),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 500),
  unit text NOT NULL CHECK (char_length(btrim(unit)) BETWEEN 1 AND 500),
  min_stock bigint NOT NULL CHECK (min_stock BETWEEN 0 AND 1000000000),
  -- Set once at creation; the insert trigger turns it into the OPENING movement.
  opening_stock bigint NOT NULL DEFAULT 0 CHECK (opening_stock BETWEEN 0 AND 1000000000),
  created_by_user_id text REFERENCES procurement.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE TABLE procurement.suppliers (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 500),
  email text NOT NULL CHECK (char_length(email) BETWEEN 1 AND 254),
  phone text NOT NULL DEFAULT '' CHECK (char_length(phone) <= 40),
  reputation numeric NOT NULL CHECK (reputation BETWEEN 1 AND 100),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

-- Financial numeric columns intentionally have no scale typmod: PostgreSQL
-- would round before CHECK validation. CHECKs reject fractional VND and VAT
-- beyond two decimals while arithmetic remains exact.
CREATE TABLE procurement.prices (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  product_id text NOT NULL REFERENCES procurement.products(id) ON DELETE RESTRICT,
  supplier_id text NOT NULL REFERENCES procurement.suppliers(id) ON DELETE RESTRICT,
  unit_price numeric NOT NULL CHECK (unit_price BETWEEN 1 AND 10000000000 AND unit_price=trunc(unit_price)),
  delivery_days integer NOT NULL CHECK (delivery_days BETWEEN 1 AND 365),
  quality_score numeric NOT NULL CHECK (quality_score BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  UNIQUE (supplier_id,product_id)
);

-- Agent records remain compatibility data; this migration starts no Agent.
-- Forward references from runs are added after all document tables exist.
CREATE TABLE procurement.agent_runs (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  product_id text NOT NULL REFERENCES procurement.products(id) ON DELETE RESTRICT,
  request_id text,
  rfq_id text,
  session_id text,
  order_id text,
  status text NOT NULL CHECK (status IN ('starting','waiting_approval_1','collecting',
    'waiting_approval_2','ready_to_order','completed','rejected','error')),
  stage integer NOT NULL CHECK (stage BETWEEN 1 AND 4),
  created_by text NOT NULL REFERENCES procurement.users(id) ON DELETE RESTRICT,
  quantity bigint NOT NULL CHECK (quantity BETWEEN 1 AND 10000000),
  tokens_used bigint NOT NULL DEFAULT 0 CHECK (tokens_used BETWEEN 0 AND 9007199254740991),
  step_count integer NOT NULL DEFAULT 0 CHECK (step_count BETWEEN 0 AND 30),
  demo boolean NOT NULL DEFAULT false,
  error text CHECK (char_length(error) <= 2000),
  usage_ids text[] NOT NULL DEFAULT '{}' CHECK (array_position(usage_ids,NULL) IS NULL),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE TABLE procurement.requests (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  status text NOT NULL CHECK (status IN ('pending','approved','rejected')),
  created_by_user_id text REFERENCES procurement.users(id) ON DELETE RESTRICT,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user','agent')),
  run_id text REFERENCES procurement.agent_runs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  CHECK ((actor_kind='user' AND created_by_user_id IS NOT NULL)
    OR (actor_kind='agent' AND created_by_user_id IS NULL AND run_id IS NOT NULL)),
  UNIQUE (id,status)
);

CREATE TABLE procurement.request_lines (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  request_id text NOT NULL REFERENCES procurement.requests(id) ON DELETE RESTRICT,
  line_no integer NOT NULL CHECK (line_no > 0),
  product_id text NOT NULL REFERENCES procurement.products(id) ON DELETE RESTRICT,
  quantity bigint NOT NULL CHECK (quantity BETWEEN 1 AND 10000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id,line_no),
  UNIQUE (id,request_id,product_id)
);

CREATE TABLE procurement.rfqs (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  request_line_id text NOT NULL UNIQUE,
  -- These typed keys make request/product lineage enforceable by FK, and must
  -- be populated from the selected request_line by the repository.
  request_id text NOT NULL,
  product_id text NOT NULL,
  -- Constant half of a state FK: an RFQ can only reference an approved request,
  -- and a request with an RFQ can no longer leave that status.
  request_status text NOT NULL DEFAULT 'approved' CHECK (request_status='approved'),
  status text NOT NULL CHECK (status IN ('open','closed')),
  run_id text REFERENCES procurement.agent_runs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  FOREIGN KEY (request_line_id,request_id,product_id)
    REFERENCES procurement.request_lines(id,request_id,product_id) ON DELETE RESTRICT,
  FOREIGN KEY (request_id,request_status) REFERENCES procurement.requests(id,status) ON DELETE RESTRICT,
  UNIQUE (id,request_id),
  UNIQUE (id,product_id)
);

CREATE TABLE procurement.rfq_suppliers (
  rfq_id text NOT NULL REFERENCES procurement.rfqs(id) ON DELETE RESTRICT,
  supplier_id text NOT NULL REFERENCES procurement.suppliers(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rfq_id,supplier_id)
);

CREATE TABLE procurement.quotations (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  rfq_id text NOT NULL,
  supplier_id text NOT NULL,
  quantity bigint NOT NULL CHECK (quantity BETWEEN 1 AND 10000000),
  unit_price numeric NOT NULL CHECK (unit_price BETWEEN 1 AND 10000000000 AND unit_price=trunc(unit_price)),
  vat numeric NOT NULL DEFAULT 0 CHECK (vat BETWEEN 0 AND 100 AND vat=round(vat,2)),
  currency text NOT NULL DEFAULT 'VND' CHECK (currency='VND'),
  delivery_days integer NOT NULL CHECK (delivery_days BETWEEN 1 AND 365),
  quality_score numeric NOT NULL CHECK (quality_score BETWEEN 1 AND 100),
  valid_until date NOT NULL CHECK (isfinite(valid_until)),
  source text NOT NULL DEFAULT 'manual' CHECK (char_length(source) <= 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  FOREIGN KEY (rfq_id,supplier_id) REFERENCES procurement.rfq_suppliers(rfq_id,supplier_id) ON DELETE RESTRICT,
  UNIQUE (rfq_id,supplier_id),
  UNIQUE (id,rfq_id,supplier_id),
  CHECK (round(quantity::numeric * unit_price * (100 + vat) / 100,0) <= 9007199254740991)
);

CREATE TABLE procurement.ahp_sessions (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  rfq_id text NOT NULL REFERENCES procurement.rfqs(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('draft','pending_approval','approved','rejected','stale')),
  cr double precision NOT NULL CHECK (cr >= 0 AND cr < 'Infinity'::double precision),
  consistent boolean NOT NULL,
  input_artifact jsonb NOT NULL CHECK (jsonb_typeof(input_artifact)='object'),
  result_artifact jsonb NOT NULL CHECK (jsonb_typeof(result_artifact)='object'),
  run_id text REFERENCES procurement.agent_runs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  UNIQUE (id,rfq_id)
);
-- At most one session per RFQ can be awaiting or holding an approval.
CREATE UNIQUE INDEX ahp_one_live_session ON procurement.ahp_sessions(rfq_id)
  WHERE status IN ('pending_approval','approved');

CREATE TABLE procurement.ahp_candidates (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  session_id text NOT NULL,
  rfq_id text NOT NULL,
  quotation_id text NOT NULL,
  supplier_id text NOT NULL,
  supplier_name text NOT NULL CHECK (char_length(btrim(supplier_name)) BETWEEN 1 AND 500),
  quantity bigint NOT NULL CHECK (quantity BETWEEN 1 AND 10000000),
  unit_price numeric NOT NULL CHECK (unit_price BETWEEN 1 AND 10000000000 AND unit_price=trunc(unit_price)),
  vat numeric NOT NULL CHECK (vat BETWEEN 0 AND 100 AND vat=round(vat,2)),
  currency text NOT NULL CHECK (currency='VND'),
  delivery_days integer NOT NULL CHECK (delivery_days BETWEEN 1 AND 365),
  quality_score numeric NOT NULL CHECK (quality_score BETWEEN 1 AND 100),
  valid_until date NOT NULL CHECK (isfinite(valid_until)),
  source text NOT NULL CHECK (char_length(source) <= 10000),
  quotation_created_at timestamptz NOT NULL,
  quotation_updated_at timestamptz,
  criterion_inputs jsonb NOT NULL CHECK (jsonb_typeof(criterion_inputs)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id,rfq_id) REFERENCES procurement.ahp_sessions(id,rfq_id) ON DELETE RESTRICT,
  FOREIGN KEY (quotation_id,rfq_id,supplier_id) REFERENCES procurement.quotations(id,rfq_id,supplier_id) ON DELETE RESTRICT,
  UNIQUE (session_id,supplier_id),
  -- A PO uses these approved unit terms. Its quantity can be smaller than the
  -- offered quantity; the service verifies it matches the requested quantity.
  -- Live quotations are outside this FK, so edits preserve the snapshot terms.
  UNIQUE (id,session_id,rfq_id,supplier_id,unit_price,vat,delivery_days),
  CHECK (round(quantity::numeric * unit_price * (100 + vat) / 100,0) <= 9007199254740991)
);

CREATE TABLE procurement.approvals (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  gate integer NOT NULL CHECK (gate IN (1,2)),
  request_id text NOT NULL REFERENCES procurement.requests(id) ON DELETE RESTRICT,
  rfq_id text,
  session_id text,
  status text NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled')),
  selected_supplier_id text,
  proposal text NOT NULL,
  comment text CHECK (char_length(comment) <= 2000),
  decided_by text REFERENCES procurement.users(id) ON DELETE RESTRICT,
  decided_at timestamptz,
  run_id text REFERENCES procurement.agent_runs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  CHECK ((gate=1 AND rfq_id IS NULL AND session_id IS NULL AND selected_supplier_id IS NULL)
    OR (gate=2 AND rfq_id IS NOT NULL AND session_id IS NOT NULL)),
  CHECK ((decided_by IS NULL AND decided_at IS NULL) OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (status NOT IN ('approved','rejected') OR decided_by IS NOT NULL),
  CHECK (NOT (gate=2 AND status='approved') OR selected_supplier_id IS NOT NULL),
  FOREIGN KEY (rfq_id,request_id) REFERENCES procurement.rfqs(id,request_id) ON DELETE RESTRICT,
  FOREIGN KEY (session_id,rfq_id) REFERENCES procurement.ahp_sessions(id,rfq_id) ON DELETE RESTRICT,
  FOREIGN KEY (session_id,selected_supplier_id) REFERENCES procurement.ahp_candidates(session_id,supplier_id) ON DELETE RESTRICT,
  -- Target of the purchase order line state FK.
  UNIQUE (id,session_id,selected_supplier_id,status)
);
CREATE UNIQUE INDEX approvals_gate1_unique ON procurement.approvals(request_id) WHERE gate=1;
CREATE UNIQUE INDEX approvals_gate2_unique ON procurement.approvals(session_id) WHERE gate=2;

CREATE TABLE procurement.orders (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  supplier_id text NOT NULL REFERENCES procurement.suppliers(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('ordered','partially_received','received')),
  sent_at timestamptz,
  run_id text REFERENCES procurement.agent_runs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  UNIQUE (id,supplier_id)
);

CREATE TABLE procurement.order_lines (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  order_id text NOT NULL,
  line_no integer NOT NULL CHECK (line_no > 0),
  rfq_id text NOT NULL UNIQUE,
  session_id text NOT NULL,
  candidate_id text NOT NULL,
  -- Constant half of a state FK: the line exists only under a gate-2 approval
  -- of this session for this supplier, which then can no longer change.
  approval_id text NOT NULL,
  approval_status text NOT NULL DEFAULT 'approved' CHECK (approval_status='approved'),
  supplier_id text NOT NULL,
  product_id text NOT NULL,
  -- Filled by trigger so renaming a product cannot rewrite an issued PO.
  product_sku text NOT NULL,
  product_name text NOT NULL,
  unit text NOT NULL,
  quantity bigint NOT NULL CHECK (quantity BETWEEN 1 AND 10000000),
  unit_price numeric NOT NULL CHECK (unit_price BETWEEN 1 AND 10000000000 AND unit_price=trunc(unit_price)),
  vat numeric NOT NULL CHECK (vat BETWEEN 0 AND 100 AND vat=round(vat,2)),
  delivery_days integer NOT NULL CHECK (delivery_days BETWEEN 1 AND 365),
  received_quantity bigint NOT NULL DEFAULT 0,
  accepted_quantity bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  CHECK (0 <= accepted_quantity AND accepted_quantity <= received_quantity AND received_quantity <= quantity),
  CHECK (round(quantity::numeric * unit_price * (100 + vat) / 100,0) <= 9007199254740991),
  UNIQUE (order_id,line_no),
  UNIQUE (id,order_id,product_id),
  FOREIGN KEY (order_id,supplier_id) REFERENCES procurement.orders(id,supplier_id) ON DELETE RESTRICT,
  FOREIGN KEY (rfq_id,product_id) REFERENCES procurement.rfqs(id,product_id) ON DELETE RESTRICT,
  FOREIGN KEY (approval_id,session_id,supplier_id,approval_status)
    REFERENCES procurement.approvals(id,session_id,selected_supplier_id,status) ON DELETE RESTRICT,
  FOREIGN KEY (candidate_id,session_id,rfq_id,supplier_id,unit_price,vat,delivery_days)
    REFERENCES procurement.ahp_candidates(id,session_id,rfq_id,supplier_id,unit_price,vat,delivery_days) ON DELETE RESTRICT
);

CREATE TABLE procurement.receipts (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  order_id text NOT NULL REFERENCES procurement.orders(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 1 AND 100),
  received_at timestamptz NOT NULL CHECK (isfinite(received_at)),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  created_by text NOT NULL REFERENCES procurement.users(id) ON DELETE RESTRICT,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  -- The normalized idempotency input retains explicit timestamp offsets and
  -- original retry semantics while the typed columns support SQL queries.
  input_payload jsonb NOT NULL CHECK (jsonb_typeof(input_payload)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,order_id)
);

CREATE TABLE procurement.receipt_lines (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  receipt_id text NOT NULL,
  order_id text NOT NULL,
  order_line_id text NOT NULL,
  product_id text NOT NULL,
  quantity bigint NOT NULL CHECK (quantity BETWEEN 1 AND 9007199254740991),
  accepted_quantity bigint NOT NULL CHECK (accepted_quantity BETWEEN 0 AND quantity),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (receipt_id,order_line_id),
  UNIQUE (id,product_id,accepted_quantity),
  FOREIGN KEY (receipt_id,order_id) REFERENCES procurement.receipts(id,order_id) ON DELETE RESTRICT,
  FOREIGN KEY (order_line_id,order_id,product_id) REFERENCES procurement.order_lines(id,order_id,product_id) ON DELETE RESTRICT
);

CREATE TABLE procurement.inventory_balances (
  product_id text PRIMARY KEY REFERENCES procurement.products(id) ON DELETE RESTRICT,
  quantity bigint NOT NULL DEFAULT 0 CHECK (quantity BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE procurement.inventory_movements (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  product_id text NOT NULL REFERENCES procurement.products(id) ON DELETE RESTRICT,
  delta bigint NOT NULL CHECK (delta BETWEEN 1 AND 9007199254740991),
  kind text NOT NULL CHECK (kind IN ('OPENING','RECEIPT')),
  receipt_line_id text UNIQUE,
  created_by_user_id text REFERENCES procurement.users(id) ON DELETE RESTRICT,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user','system')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind='OPENING' AND receipt_line_id IS NULL) OR (kind='RECEIPT' AND receipt_line_id IS NOT NULL)),
  CHECK ((actor_kind='user' AND created_by_user_id IS NOT NULL)
    OR (actor_kind='system' AND kind='OPENING' AND created_by_user_id IS NULL)),
  FOREIGN KEY (receipt_line_id,product_id,delta)
    REFERENCES procurement.receipt_lines(id,product_id,accepted_quantity) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX inventory_one_opening ON procurement.inventory_movements(product_id) WHERE kind='OPENING';

CREATE TABLE procurement.evaluations (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  order_id text NOT NULL UNIQUE,
  supplier_id text NOT NULL,
  product_id text NOT NULL REFERENCES procurement.products(id) ON DELETE RESTRICT,
  reported_quality_score numeric NOT NULL CHECK (reported_quality_score BETWEEN 1 AND 100),
  acceptance_score numeric NOT NULL CHECK (acceptance_score BETWEEN 0 AND 100),
  quality_score numeric NOT NULL CHECK (quality_score BETWEEN 0 AND 100),
  delivery_score numeric NOT NULL CHECK (delivery_score BETWEEN 0 AND 100),
  service_score numeric NOT NULL CHECK (service_score BETWEEN 1 AND 100),
  overall_score numeric NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  created_by text NOT NULL REFERENCES procurement.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (order_id,supplier_id) REFERENCES procurement.orders(id,supplier_id) ON DELETE RESTRICT
);

CREATE TABLE procurement.history (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  product_id text NOT NULL REFERENCES procurement.products(id) ON DELETE RESTRICT,
  supplier_id text NOT NULL REFERENCES procurement.suppliers(id) ON DELETE RESTRICT,
  month date NOT NULL CHECK (isfinite(month) AND extract(day FROM month)=1),
  quantity bigint NOT NULL CHECK (quantity BETWEEN 0 AND 9007199254740991),
  unit_price numeric NOT NULL CHECK (unit_price BETWEEN 1 AND 10000000000 AND unit_price=trunc(unit_price)),
  on_time boolean NOT NULL,
  quality_score numeric NOT NULL CHECK (quality_score BETWEEN 0 AND 100),
  synthetic boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE procurement.audit (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  actor_kind text NOT NULL CHECK (actor_kind IN ('user','agent')),
  actor_user_id text REFERENCES procurement.users(id) ON DELETE RESTRICT,
  actor_name text NOT NULL CHECK (char_length(btrim(actor_name)) BETWEEN 1 AND 500),
  actor_role text NOT NULL CHECK (actor_role IN ('admin','buyer','manager','warehouse','auditor','agent')),
  action text NOT NULL CHECK (char_length(btrim(action)) BETWEEN 1 AND 500),
  entity_type text CHECK (char_length(entity_type) BETWEEN 1 AND 100),
  entity_id text CHECK (char_length(entity_id) BETWEEN 1 AND 100),
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((actor_kind='user' AND actor_user_id IS NOT NULL AND actor_role<>'agent')
    OR (actor_kind='agent' AND actor_user_id IS NULL AND actor_role='agent')),
  CHECK (entity_id IS NULL OR entity_type IS NOT NULL)
);

CREATE TABLE procurement.outbox (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  message_key text NOT NULL UNIQUE CHECK (char_length(message_key) BETWEEN 1 AND 500),
  type text NOT NULL CHECK (type IN ('RFQ','PO')),
  rfq_id text,
  order_id text,
  supplier_id text NOT NULL REFERENCES procurement.suppliers(id) ON DELETE RESTRICT,
  recipient text NOT NULL CHECK (char_length(recipient) BETWEEN 1 AND 254),
  subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 500),
  text_body text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','sent','failed','simulated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  CHECK ((type='RFQ' AND rfq_id IS NOT NULL AND order_id IS NULL)
    OR (type='PO' AND order_id IS NOT NULL AND rfq_id IS NULL)),
  FOREIGN KEY (rfq_id,supplier_id) REFERENCES procurement.rfq_suppliers(rfq_id,supplier_id) ON DELETE RESTRICT,
  FOREIGN KEY (order_id,supplier_id) REFERENCES procurement.orders(id,supplier_id) ON DELETE RESTRICT
);

CREATE TABLE procurement.agent_steps (
  id text PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 100),
  run_id text NOT NULL REFERENCES procurement.agent_runs(id) ON DELETE RESTRICT,
  tool text NOT NULL CHECK (char_length(btrim(tool)) BETWEEN 1 AND 100),
  stage integer NOT NULL CHECK (stage BETWEEN 1 AND 4),
  status text NOT NULL CHECK (status IN ('completed','error','denied')),
  detail jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE procurement.schema_migrations (
  version integer PRIMARY KEY CHECK (version > 0),
  name text NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 1 AND 200),
  checksum text NOT NULL UNIQUE CHECK (checksum ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE procurement.agent_runs
  ADD FOREIGN KEY (request_id) REFERENCES procurement.requests(id) ON DELETE RESTRICT,
  ADD FOREIGN KEY (rfq_id) REFERENCES procurement.rfqs(id) ON DELETE RESTRICT,
  ADD FOREIGN KEY (session_id) REFERENCES procurement.ahp_sessions(id) ON DELETE RESTRICT,
  ADD FOREIGN KEY (order_id) REFERENCES procurement.orders(id) ON DELETE RESTRICT;

-- Derived state has exactly one writer: the triggers below. Stock balances, PO
-- line counters, PO status, ledger rows and RFQ closure all follow from inserting
-- a product, a PO line or a receipt line. The service never computes them, and
-- the depth guards reject a direct write from any role, superuser included.
-- The provisioning CLI assigns the SECURITY DEFINER functions to its dedicated
-- NOLOGIN owner; trigger execution still works after PUBLIC EXECUTE is revoked.
CREATE FUNCTION procurement.require_trigger_writer() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, procurement, pg_temp AS $$
BEGIN
  -- Depth 1 is this guard firing for a statement issued directly by a client.
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION '% is written only by procurement triggers',TG_TABLE_NAME USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION procurement.require_trigger_writer() FROM PUBLIC;

CREATE FUNCTION procurement.create_product_balance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, procurement, pg_temp AS $$
BEGIN
  INSERT INTO procurement.inventory_balances(product_id,quantity) VALUES (NEW.id,0);
  IF NEW.opening_stock > 0 THEN
    INSERT INTO procurement.inventory_movements
      (id,product_id,delta,kind,created_by_user_id,actor_kind,created_at)
    VALUES (gen_random_uuid()::text,NEW.id,NEW.opening_stock,'OPENING',NEW.created_by_user_id,
      CASE WHEN NEW.created_by_user_id IS NULL THEN 'system' ELSE 'user' END,NEW.created_at);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION procurement.create_product_balance() FROM PUBLIC;

CREATE FUNCTION procurement.delete_product_balance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, procurement, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM procurement.inventory_movements WHERE product_id=OLD.id)
    OR EXISTS (SELECT 1 FROM procurement.inventory_balances WHERE product_id=OLD.id AND quantity<>0) THEN
    RAISE EXCEPTION 'Cannot delete product with stock or inventory history' USING ERRCODE='23514';
  END IF;
  DELETE FROM procurement.inventory_balances WHERE product_id=OLD.id AND quantity=0;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION procurement.delete_product_balance() FROM PUBLIC;

CREATE FUNCTION procurement.apply_inventory_movement() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, procurement, pg_temp AS $$
BEGIN
  UPDATE procurement.inventory_balances
    SET quantity=quantity+NEW.delta,updated_at=now() WHERE product_id=NEW.product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product inventory balance is missing' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION procurement.apply_inventory_movement() FROM PUBLIC;

-- A receipt line is the only source of receiving. Counters are added relatively
-- under the row lock, so the order line CHECK rejects concurrent over-delivery
-- even when a caller took no lock of its own.
CREATE FUNCTION procurement.post_receipt_line() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, procurement, pg_temp AS $$
BEGIN
  UPDATE procurement.order_lines
    SET received_quantity=received_quantity+NEW.quantity,
        accepted_quantity=accepted_quantity+NEW.accepted_quantity
    WHERE id=NEW.order_line_id;
  -- A no-op write; the BEFORE trigger on orders recomputes its status.
  UPDATE procurement.orders SET status=status WHERE id=NEW.order_id;
  IF NEW.accepted_quantity > 0 THEN
    INSERT INTO procurement.inventory_movements
      (id,product_id,delta,kind,receipt_line_id,created_by_user_id,actor_kind,created_at)
    SELECT gen_random_uuid()::text,NEW.product_id,NEW.accepted_quantity,'RECEIPT',NEW.id,
      r.created_by,'user',NEW.created_at
    FROM procurement.receipts r WHERE r.id=NEW.receipt_id;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION procurement.post_receipt_line() FROM PUBLIC;

-- Whatever status a writer supplies is replaced by the one its lines imply.
CREATE FUNCTION procurement.derive_order_status() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, procurement, pg_temp AS $$
BEGIN
  SELECT CASE WHEN count(*)=0 OR sum(received_quantity)=0 THEN 'ordered'
              WHEN bool_and(received_quantity=quantity) THEN 'received'
              ELSE 'partially_received' END
    INTO NEW.status FROM procurement.order_lines WHERE order_id=NEW.id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION procurement.derive_order_status() FROM PUBLIC;

CREATE FUNCTION procurement.prepare_order_line() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, procurement, pg_temp AS $$
BEGIN
  SELECT sku,name,unit INTO NEW.product_sku,NEW.product_name,NEW.unit
    FROM procurement.products WHERE id=NEW.product_id;
  NEW.received_quantity=0;
  NEW.accepted_quantity=0;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION procurement.prepare_order_line() FROM PUBLIC;

CREATE FUNCTION procurement.close_ordered_rfq() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, procurement, pg_temp AS $$
BEGIN
  UPDATE procurement.rfqs SET status='closed' WHERE id=NEW.rfq_id AND status='open';
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION procurement.close_ordered_rfq() FROM PUBLIC;

CREATE TRIGGER products_create_balance AFTER INSERT ON procurement.products
  FOR EACH ROW EXECUTE FUNCTION procurement.create_product_balance();
CREATE TRIGGER products_delete_balance BEFORE DELETE ON procurement.products
  FOR EACH ROW EXECUTE FUNCTION procurement.delete_product_balance();
CREATE TRIGGER inventory_trigger_only BEFORE INSERT ON procurement.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION procurement.require_trigger_writer();
CREATE TRIGGER inventory_apply AFTER INSERT ON procurement.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION procurement.apply_inventory_movement();
CREATE TRIGGER balances_trigger_only BEFORE INSERT OR UPDATE OR DELETE ON procurement.inventory_balances
  FOR EACH ROW EXECUTE FUNCTION procurement.require_trigger_writer();
CREATE TRIGGER orders_derive_status BEFORE INSERT OR UPDATE ON procurement.orders
  FOR EACH ROW EXECUTE FUNCTION procurement.derive_order_status();
CREATE TRIGGER order_lines_prepare BEFORE INSERT ON procurement.order_lines
  FOR EACH ROW EXECUTE FUNCTION procurement.prepare_order_line();
CREATE TRIGGER order_lines_close_rfq AFTER INSERT ON procurement.order_lines
  FOR EACH ROW EXECUTE FUNCTION procurement.close_ordered_rfq();
CREATE TRIGGER receipt_lines_post AFTER INSERT ON procurement.receipt_lines
  FOR EACH ROW EXECUTE FUNCTION procurement.post_receipt_line();

-- Append-only records. TRUNCATE fires statement triggers only, so it is blocked
-- separately from row-level UPDATE and DELETE.
CREATE FUNCTION procurement.reject_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, procurement, pg_temp AS $$
BEGIN
  RAISE EXCEPTION '% is append-only',TG_TABLE_NAME USING ERRCODE='23514';
END;
$$;
REVOKE ALL ON FUNCTION procurement.reject_mutation() FROM PUBLIC;

DO $$
DECLARE append_only text;
BEGIN
  FOREACH append_only IN ARRAY ARRAY['request_lines','rfq_suppliers','ahp_candidates','receipts',
    'receipt_lines','inventory_movements','evaluations','audit','agent_steps','schema_migrations'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON procurement.%I
      FOR EACH ROW EXECUTE FUNCTION procurement.reject_mutation()',append_only||'_immutable',append_only);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON procurement.%I
      FOR EACH STATEMENT EXECUTE FUNCTION procurement.reject_mutation()',append_only||'_no_truncate',append_only);
  END LOOP;
END;
$$;

-- Lifecycle records: only the columns named in the trigger arguments may change.
CREATE FUNCTION procurement.protect_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, procurement, pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION '% rows cannot be deleted',TG_TABLE_NAME USING ERRCODE='23514';
  END IF;
  IF (to_jsonb(NEW) - TG_ARGV::text[]) IS DISTINCT FROM (to_jsonb(OLD) - TG_ARGV::text[]) THEN
    RAISE EXCEPTION '% allows changes only to %',TG_TABLE_NAME,array_to_string(TG_ARGV,', ') USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION procurement.protect_columns() FROM PUBLIC;

-- Arguments are the legal 'from>to' status moves. A status with no outgoing move
-- is final, and a row in a final status is frozen entirely.
CREATE FUNCTION procurement.guard_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, procurement, pg_temp AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status||'>'||NEW.status) = ANY (TG_ARGV::text[])) THEN
      RAISE EXCEPTION '% cannot move from % to %',TG_TABLE_NAME,OLD.status,NEW.status USING ERRCODE='23514';
    END IF;
  ELSIF NEW IS DISTINCT FROM OLD
    AND NOT EXISTS (SELECT 1 FROM unnest(TG_ARGV::text[]) move WHERE move LIKE OLD.status||'>%') THEN
    RAISE EXCEPTION '% in status % is final',TG_TABLE_NAME,OLD.status USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION procurement.guard_transition() FROM PUBLIC;

CREATE TRIGGER products_fixed_identity BEFORE UPDATE ON procurement.products
  FOR EACH ROW EXECUTE FUNCTION procurement.protect_columns('sku','name','min_stock','updated_at');

CREATE TRIGGER requests_lifecycle_columns BEFORE UPDATE OR DELETE ON procurement.requests
  FOR EACH ROW EXECUTE FUNCTION procurement.protect_columns('status','updated_at');
CREATE TRIGGER requests_transitions BEFORE UPDATE ON procurement.requests
  FOR EACH ROW EXECUTE FUNCTION procurement.guard_transition('pending>approved','pending>rejected');

CREATE TRIGGER rfqs_lifecycle_columns BEFORE UPDATE OR DELETE ON procurement.rfqs
  FOR EACH ROW EXECUTE FUNCTION procurement.protect_columns('status','updated_at');
CREATE TRIGGER rfqs_transitions BEFORE UPDATE ON procurement.rfqs
  FOR EACH ROW EXECUTE FUNCTION procurement.guard_transition('open>closed');

CREATE TRIGGER ahp_sessions_lifecycle_columns BEFORE UPDATE OR DELETE ON procurement.ahp_sessions
  FOR EACH ROW EXECUTE FUNCTION procurement.protect_columns('status','updated_at');
CREATE TRIGGER ahp_sessions_transitions BEFORE UPDATE ON procurement.ahp_sessions
  FOR EACH ROW EXECUTE FUNCTION procurement.guard_transition('draft>pending_approval','draft>stale',
    'pending_approval>approved','pending_approval>rejected','pending_approval>stale',
    'approved>stale','rejected>stale');

CREATE TRIGGER approvals_lifecycle_columns BEFORE UPDATE OR DELETE ON procurement.approvals
  FOR EACH ROW EXECUTE FUNCTION procurement.protect_columns('status','selected_supplier_id','comment',
    'decided_by','decided_at','updated_at');
CREATE TRIGGER approvals_transitions BEFORE UPDATE ON procurement.approvals
  FOR EACH ROW EXECUTE FUNCTION procurement.guard_transition('pending>approved','pending>rejected','pending>cancelled');

CREATE TRIGGER orders_lifecycle_columns BEFORE UPDATE OR DELETE ON procurement.orders
  FOR EACH ROW EXECUTE FUNCTION procurement.protect_columns('status','sent_at','updated_at');

-- PO terms never change; counters change only from post_receipt_line.
CREATE FUNCTION procurement.protect_order_line() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, procurement, pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Purchase order lines cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['received_quantity','accepted_quantity','updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['received_quantity','accepted_quantity','updated_at']) THEN
    RAISE EXCEPTION 'Purchase order source and financial terms are immutable' USING ERRCODE='23514';
  END IF;
  IF (NEW.received_quantity,NEW.accepted_quantity) IS DISTINCT FROM (OLD.received_quantity,OLD.accepted_quantity)
    AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'Purchase order counters are written only by receipt lines' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION procurement.protect_order_line() FROM PUBLIC;
CREATE TRIGGER order_lines_immutable BEFORE UPDATE OR DELETE ON procurement.order_lines
  FOR EACH ROW EXECUTE FUNCTION procurement.protect_order_line();

-- Index FK lookups not already covered by a PK/UNIQUE prefix, and the planned
-- filtered/ordered queries. Composite keys above also support lineage checks.
CREATE INDEX prices_product ON procurement.prices(product_id);
CREATE INDEX requests_creator ON procurement.requests(created_by_user_id);
CREATE INDEX requests_run ON procurement.requests(run_id);
CREATE INDEX requests_status_created ON procurement.requests(status,created_at,id);
CREATE INDEX request_lines_product ON procurement.request_lines(product_id);
CREATE INDEX rfqs_request ON procurement.rfqs(request_id);
CREATE INDEX rfqs_product ON procurement.rfqs(product_id);
CREATE INDEX rfqs_run ON procurement.rfqs(run_id);
CREATE INDEX rfq_suppliers_supplier ON procurement.rfq_suppliers(supplier_id);
CREATE INDEX quotations_supplier ON procurement.quotations(supplier_id);
CREATE INDEX ahp_sessions_rfq ON procurement.ahp_sessions(rfq_id,created_at,id);
CREATE INDEX ahp_sessions_run ON procurement.ahp_sessions(run_id);
CREATE INDEX ahp_candidates_quotation ON procurement.ahp_candidates(quotation_id);
CREATE INDEX ahp_candidates_rfq ON procurement.ahp_candidates(rfq_id);
CREATE INDEX ahp_candidates_supplier ON procurement.ahp_candidates(supplier_id);
CREATE INDEX approvals_request ON procurement.approvals(request_id);
CREATE INDEX approvals_rfq ON procurement.approvals(rfq_id);
CREATE INDEX approvals_selected_supplier ON procurement.approvals(selected_supplier_id);
CREATE INDEX approvals_decider ON procurement.approvals(decided_by);
CREATE INDEX approvals_run ON procurement.approvals(run_id);
CREATE INDEX approvals_pending_created ON procurement.approvals(created_at,id) WHERE status='pending';
CREATE INDEX orders_supplier ON procurement.orders(supplier_id);
CREATE INDEX orders_run ON procurement.orders(run_id);
CREATE INDEX orders_status_created ON procurement.orders(status,created_at,id);
CREATE INDEX order_lines_session ON procurement.order_lines(session_id);
CREATE INDEX order_lines_candidate ON procurement.order_lines(candidate_id);
CREATE INDEX order_lines_product ON procurement.order_lines(product_id);
CREATE INDEX order_lines_supplier ON procurement.order_lines(supplier_id);
CREATE INDEX order_lines_approval ON procurement.order_lines(approval_id);
CREATE INDEX products_creator ON procurement.products(created_by_user_id);
CREATE INDEX receipts_order_received ON procurement.receipts(order_id,received_at,id);
CREATE INDEX receipts_creator ON procurement.receipts(created_by);
CREATE INDEX receipt_lines_order ON procurement.receipt_lines(order_id);
CREATE INDEX receipt_lines_order_line ON procurement.receipt_lines(order_line_id);
CREATE INDEX receipt_lines_product ON procurement.receipt_lines(product_id);
CREATE INDEX inventory_movements_product ON procurement.inventory_movements(product_id,created_at,id);
CREATE INDEX inventory_movements_creator ON procurement.inventory_movements(created_by_user_id);
CREATE INDEX evaluations_supplier ON procurement.evaluations(supplier_id);
CREATE INDEX evaluations_product ON procurement.evaluations(product_id);
CREATE INDEX evaluations_creator ON procurement.evaluations(created_by);
CREATE INDEX history_product_month ON procurement.history(product_id,month);
CREATE INDEX history_supplier_month ON procurement.history(supplier_id,month);
CREATE INDEX audit_actor ON procurement.audit(actor_user_id);
CREATE INDEX audit_created ON procurement.audit(created_at,id);
CREATE INDEX audit_entity ON procurement.audit(entity_type,entity_id);
CREATE INDEX outbox_rfq ON procurement.outbox(rfq_id);
CREATE INDEX outbox_order ON procurement.outbox(order_id);
CREATE INDEX outbox_supplier ON procurement.outbox(supplier_id);
CREATE INDEX outbox_pending_created ON procurement.outbox(created_at,id) WHERE status='pending';
CREATE INDEX agent_runs_product ON procurement.agent_runs(product_id);
CREATE INDEX agent_runs_request ON procurement.agent_runs(request_id);
CREATE INDEX agent_runs_rfq ON procurement.agent_runs(rfq_id);
CREATE INDEX agent_runs_session ON procurement.agent_runs(session_id);
CREATE INDEX agent_runs_order ON procurement.agent_runs(order_id);
CREATE INDEX agent_runs_creator ON procurement.agent_runs(created_by);
CREATE INDEX agent_steps_run_created ON procurement.agent_steps(run_id,created_at,id);
