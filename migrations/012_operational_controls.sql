CREATE TABLE klaro.operational_controls (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  ai_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO klaro.operational_controls DEFAULT VALUES;
CREATE TABLE klaro.admin_audit (
  id bigserial PRIMARY KEY,
  actor varchar(128) NOT NULL,
  action text NOT NULL CHECK (action IN ('ai-enabled', 'ai-disabled', 'metrics-read')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_created ON klaro.admin_audit(created_at);
