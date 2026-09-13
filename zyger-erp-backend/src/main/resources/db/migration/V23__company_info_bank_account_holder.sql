--
-- V23__company_info_bank_account_holder.sql
-- Tax-invoice "Bank Transfer Details" — editable Account Name.
--
-- The invoice bank block shows the account holder under "Account Name".
-- Previously the company name was used as a fixed fallback; this column lets
-- the user set the actual registered account name (falls back to the company
-- name when left blank on the invoice).
--
-- SAFETY:
--   - Idempotent (IF NOT EXISTS) — safe for the dev profile, which also runs
--     Hibernate ddl-auto=update on the same table.
--   - No table drop, no data rewrites.
--
ALTER TABLE public.company_info
    ADD COLUMN IF NOT EXISTS bank_account_holder varchar(200);