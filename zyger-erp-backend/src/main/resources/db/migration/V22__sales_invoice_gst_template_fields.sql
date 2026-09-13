--
-- V22__sales_invoice_gst_template_fields.sql
-- GST tax-invoice print template support.
--
-- sales_invoice.vehicle_no           Vehicle number shown on the Tax Invoice
--                                    transport/meta grid (was missing; printed blank).
-- sales_invoice.date_time_of_supply   Date & time of supply shown in the invoice
--                                    meta grid (GST invoice requirement).
-- sales_invoice.place_of_supply_code  2-digit GST state code for the Place of Supply
--                                    (auto-derived from the customer GSTIN first two
--                                    digits when blank at creation).
-- company_info.gst_state_code        2-digit GST state code of the company's own
--                                    registered state (used for tax-type/POS display).
--
-- SAFETY:
--   - Idempotent (IF NOT EXISTS) — safe for the dev profile, which also runs
--     Hibernate ddl-auto=update on the same tables.
--   - No table drop, no data rewrites.
--
ALTER TABLE public.sales_invoice
    ADD COLUMN IF NOT EXISTS vehicle_no             varchar(60),
    ADD COLUMN IF NOT EXISTS date_time_of_supply    timestamptz,
    ADD COLUMN IF NOT EXISTS place_of_supply_code   varchar(2);

ALTER TABLE public.company_info
    ADD COLUMN IF NOT EXISTS gst_state_code         varchar(2);