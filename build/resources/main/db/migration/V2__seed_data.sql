INSERT INTO departments (name) VALUES
    ('Procurement'), ('Finance'), ('Human Resources'), ('IT'), ('Admin'),
    ('Marketing'), ('Legal'), ('Sales'), ('Operations');

INSERT INTO gates (name, active) VALUES ('Gate 1', TRUE), ('Gate 2', TRUE), ('Gate 3', TRUE);

INSERT INTO visitor_profiles (full_name, phone, email, company) VALUES
    ('Ravi Malhotra',  '98450 11223', 'ravi.m@nimbus.co',          'Nimbus Logistics'),
    ('Priya Nair',     '90080 44556', 'priya.nair@finlace.com',    'Finlace Consulting'),
    ('John Kurian',    '99870 22110', 'john.k@abcltd.com',         'ABC Ltd'),
    ('Meera Kumar',    '98220 77812', 'meera.kumar@xyzpvt.com',    'XYZ Pvt Ltd'),
    ('Arjun Das',      '97010 33421', 'arjun.das@skyline.in',      'Skyline Builders'),
    ('Sana Sheikh',    '96330 55009', 'sana.sheikh@northwind.co',  'Northwind Media'),
    ('Vikram Rathore', '95500 88776', 'vikram.r@everest.co',       'Everest Traders'),
    ('Ananya Iyer',    '93450 12987', 'ananya.iyer@bluepeak.io',   'BluePeak Software'),
    ('Farhan Ali',     '90019 66432', 'farhan.ali@greenleaf.com',  'GreenLeaf Foods'),
    ('Ritu Chawla',    '92210 44098', 'ritu.chawla@orbitins.com',  'Orbit Insurance');

INSERT INTO visits (visit_code, pass_id, visitor_id, purpose, host_name, department_id,
                    visit_date, visit_time, status, check_in_at, check_out_at)
VALUES
 ('V-001', 'QR-' || to_char(CURRENT_DATE, 'YYYY') || '-0001',
  (SELECT id FROM visitor_profiles WHERE phone = '98450 11223'), 'Vendor Meeting', 'Aditi Rao',
  (SELECT id FROM departments WHERE name = 'Procurement'),
  CURRENT_DATE, TIME '09:30', 'CHECKED_IN', CURRENT_DATE + TIME '09:41', NULL),
 ('V-002', 'QR-' || to_char(CURRENT_DATE, 'YYYY') || '-0002',
  (SELECT id FROM visitor_profiles WHERE phone = '90080 44556'), 'Audit Review', 'Karan Shah',
  (SELECT id FROM departments WHERE name = 'Finance'),
  CURRENT_DATE, TIME '10:00', 'PENDING_APPROVAL', NULL, NULL),
 ('V-003', 'QR-' || to_char(CURRENT_DATE, 'YYYY') || '-0003',
  (SELECT id FROM visitor_profiles WHERE phone = '99870 22110'), 'Interview', 'HR Desk',
  (SELECT id FROM departments WHERE name = 'Human Resources'),
  CURRENT_DATE, TIME '10:15', 'CHECKED_IN', CURRENT_DATE + TIME '10:20', NULL),
 ('V-004', 'QR-' || to_char(CURRENT_DATE, 'YYYY') || '-0004',
  (SELECT id FROM visitor_profiles WHERE phone = '98220 77812'), 'System Demo', 'Dev Patel',
  (SELECT id FROM departments WHERE name = 'IT'),
  CURRENT_DATE, TIME '11:00', 'CHECKED_OUT', CURRENT_DATE + TIME '11:05', CURRENT_DATE + TIME '12:10'),
 ('V-005', 'QR-' || to_char(CURRENT_DATE, 'YYYY') || '-0005',
  (SELECT id FROM visitor_profiles WHERE phone = '97010 33421'), 'Site Inspection', 'Facilities Team',
  (SELECT id FROM departments WHERE name = 'Admin'),
  CURRENT_DATE, TIME '11:30', 'APPROVED', NULL, NULL),
 ('V-006', 'QR-' || to_char(CURRENT_DATE, 'YYYY') || '-0006',
  (SELECT id FROM visitor_profiles WHERE phone = '96330 55009'), 'Press Briefing', 'Comms Team',
  (SELECT id FROM departments WHERE name = 'Marketing'),
  CURRENT_DATE, TIME '12:00', 'PENDING_APPROVAL', NULL, NULL),
 ('V-007', 'QR-' || to_char(CURRENT_DATE, 'YYYY') || '-0007',
  (SELECT id FROM visitor_profiles WHERE phone = '95500 88776'), 'Contract Signing', 'Legal Team',
  (SELECT id FROM departments WHERE name = 'Legal'),
  CURRENT_DATE, TIME '13:00', 'REJECTED', NULL, NULL),
 ('V-008', 'QR-' || to_char(CURRENT_DATE, 'YYYY') || '-0008',
  (SELECT id FROM visitor_profiles WHERE phone = '93450 12987'), 'Client Onboarding', 'Sales Desk',
  (SELECT id FROM departments WHERE name = 'Sales'),
  CURRENT_DATE, TIME '13:45', 'CHECKED_IN', CURRENT_DATE + TIME '13:50', NULL),
 ('V-009', 'QR-' || to_char(CURRENT_DATE, 'YYYY') || '-0009',
  (SELECT id FROM visitor_profiles WHERE phone = '90019 66432'), 'Quality Audit', 'Ops Team',
  (SELECT id FROM departments WHERE name = 'Operations'),
  CURRENT_DATE, TIME '14:30', 'APPROVED', NULL, NULL),
 ('V-010', 'QR-' || to_char(CURRENT_DATE, 'YYYY') || '-0010',
  (SELECT id FROM visitor_profiles WHERE phone = '92210 44098'), 'Employee Benefits Review', 'HR Desk',
  (SELECT id FROM departments WHERE name = 'Human Resources'),
  CURRENT_DATE, TIME '15:00', 'CHECKED_OUT', CURRENT_DATE + TIME '15:04', CURRENT_DATE + TIME '15:40');

INSERT INTO vehicle_entries (entry_code, vehicle_number, driver_name, vendor, material, purpose,
                             gate_id, entry_at, exit_at)
VALUES
 ('VH-001', 'KA 05 MN 4471', 'Suresh Yadav', 'Nimbus Logistics', 'Office Supplies', 'Delivery',
  (SELECT id FROM gates WHERE name = 'Gate 2'), CURRENT_DATE + TIME '09:15', NULL),
 ('VH-002', 'KA 03 AB 9981', 'Manoj Kumar', 'GreenLeaf Foods', 'Pantry Stock', 'Delivery',
  (SELECT id FROM gates WHERE name = 'Gate 1'), CURRENT_DATE + TIME '10:40', CURRENT_DATE + TIME '11:05'),
 ('VH-003', 'KA 41 CD 1123', 'Ismail Sheikh', 'Skyline Builders', 'Construction Material', 'Site Work',
  (SELECT id FROM gates WHERE name = 'Gate 3'), CURRENT_DATE + TIME '11:35', NULL);

SELECT setval('visit_code_seq', 10);
SELECT setval('vehicle_code_seq', 3);
