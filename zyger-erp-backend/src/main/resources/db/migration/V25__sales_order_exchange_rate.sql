ALTER TABLE public.sales_order ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,6) DEFAULT 1;
ALTER TABLE public.sales_order ADD COLUMN IF NOT EXISTS target_delivery_date date;
ALTER TABLE public.sales_order ADD COLUMN IF NOT EXISTS credit_limit_status varchar(30);
ALTER TABLE public.sales_order ADD COLUMN IF NOT EXISTS compliance_checklist varchar(60);
ALTER TABLE public.sales_order ADD COLUMN IF NOT EXISTS delivery_status varchar(30);
