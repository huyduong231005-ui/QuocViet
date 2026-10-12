-- Merge active warehouse accounts into the buying role without changing
-- account IDs, credentials, document ownership or historical audit roles.
UPDATE procurement.users SET role = 'buyer' WHERE role = 'warehouse';
ALTER TABLE procurement.users DROP CONSTRAINT users_role_check;
ALTER TABLE procurement.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin','buyer','manager','auditor'));
