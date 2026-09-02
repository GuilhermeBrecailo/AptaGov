-- The runtime applies the conditional repair for databases that already ran
-- the pre-fix 030 table swap. This marker keeps the repair additive and
-- idempotent while allowing fresh databases to retain the 023 contract.
SELECT 1;
