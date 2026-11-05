-- V4: photos captured with visitor registrations and vehicle entries.
-- code = visit code (V-001) or vehicle entry code (VH-001).
CREATE TABLE photos (
    code         VARCHAR(20) PRIMARY KEY,
    content_type VARCHAR(50) NOT NULL,
    data         BYTEA       NOT NULL,
    created_at   TIMESTAMP   NOT NULL DEFAULT now()
);
