-- V5: (1) remove any remaining demo rows that V2 inserted, matched by content so that
--         rows created under other codes are removed too; real registrations are never matched.
--     (2) vehicle load weight in kilograms.
--     (3) the gate a visitor is registered for.

-- demo visits, matched by their purpose and host pair
DELETE FROM visits v
 USING (VALUES
        ('Vendor Meeting', 'Aditi Rao'), ('Audit Review', 'Karan Shah'), ('Interview', 'HR Desk'),
        ('System Demo', 'Dev Patel'), ('Site Inspection', 'Facilities Team'), ('Press Briefing', 'Comms Team'),
        ('Contract Signing', 'Legal Team'), ('Client Onboarding', 'Sales Desk'), ('Quality Audit', 'Ops Team'),
        ('Employee Benefits Review', 'HR Desk')
       ) AS demo(purpose, host)
 WHERE v.purpose = demo.purpose AND v.host_name = demo.host;

-- demo vehicles, matched by number and driver
DELETE FROM vehicle_entries e
 USING (VALUES
        ('KA 05 MN 4471', 'Suresh Yadav'), ('KA 03 AB 9981', 'Manoj Kumar'), ('KA 41 CD 1123', 'Ismail Sheikh')
       ) AS demo(vehicle_number, driver_name)
 WHERE e.vehicle_number = demo.vehicle_number AND e.driver_name = demo.driver_name;

-- demo visitor profiles that no longer have any visit
DELETE FROM visitor_profiles p
 WHERE p.phone IN ('98450 11223','90080 44556','99870 22110','98220 77812',
                   '97010 33421','96330 55009','95500 88776','93450 12987',
                   '90019 66432','92210 44098')
   AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.visitor_id = p.id);

ALTER TABLE vehicle_entries ADD COLUMN IF NOT EXISTS load_weight_kg NUMERIC(10, 2);

ALTER TABLE visits ADD COLUMN IF NOT EXISTS gate_id BIGINT REFERENCES gates (id);
CREATE INDEX IF NOT EXISTS idx_visits_check_in ON visits (check_in_at);
CREATE INDEX IF NOT EXISTS idx_vehicle_entries_exit ON vehicle_entries (exit_at);

-- restart visible numbering when nothing real exists yet
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM visits) THEN
        PERFORM setval('visit_code_seq', 1, false);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vehicle_entries) THEN
        PERFORM setval('vehicle_code_seq', 1, false);
    END IF;
END $$;
