--
-- V24__supplier_quotation_expected_delivery_date.sql
-- Supplier Quotation — "Expected Delivery Date" header field, so the
-- Quotation Comparison matrix can rank/highlight the fastest-delivery bid
-- alongside the lowest-price (L1) one instead of only comparing price.
--
-- SAFETY:
--   - Idempotent (IF NOT EXISTS) — safe for the dev profile, which also runs
--     Hibernate ddl-auto=update on the same table.
--   - No table drop, no data rewrites. Nullable — existing rows are
--     unaffected and simply show no expected delivery date until edited.
--
ALTER TABLE public.supplier_quotation
    ADD COLUMN IF NOT EXISTS expected_delivery_date date;
