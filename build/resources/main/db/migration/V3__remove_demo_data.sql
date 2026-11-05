-- V3: remove the demo / mock rows that V2 inserted so the application shows
-- LIVE entries only. Departments, gates and login accounts (reference data) stay.
-- Only rows that exactly match the original demo records are removed, so any
-- real visit or vehicle entered by users is never touched.

DELETE FROM visits
 WHERE visit_code IN ('V-001','V-002','V-003','V-004','V-005',
                      'V-006','V-007','V-008','V-009','V-010')
   AND visitor_id IN (SELECT id FROM visitor_profiles
                       WHERE phone IN ('98450 11223','90080 44556','99870 22110','98220 77812',
                                       '97010 33421','96330 55009','95500 88776','93450 12987',
                                       '90019 66432','92210 44098'));

DELETE FROM vehicle_entries
 WHERE entry_code IN ('VH-001','VH-002','VH-003')
   AND vehicle_number IN ('KA 05 MN 4471','KA 03 AB 9981','KA 41 CD 1123');

-- demo visitor profiles that no longer have any visit
DELETE FROM visitor_profiles p
 WHERE p.phone IN ('98450 11223','90080 44556','99870 22110','98220 77812',
                   '97010 33421','96330 55009','95500 88776','93450 12987',
                   '90019 66432','92210 44098')
   AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.visitor_id = p.id);

-- restart the visible numbering (V-001, VH-001 ...) only when nothing real exists yet
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM visits) THEN
        PERFORM setval('visit_code_seq', 1, false);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vehicle_entries) THEN
        PERFORM setval('vehicle_code_seq', 1, false);
    END IF;
END $$;
