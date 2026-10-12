-- A PO with several lines gets one evaluation that belongs to no single
-- product. One-line POs keep their product as before.
ALTER TABLE procurement.evaluations ALTER COLUMN product_id DROP NOT NULL;
