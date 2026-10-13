CREATE TABLE klaro.ai_supplements (
  id uuid PRIMARY KEY,
  entry_id uuid NOT NULL, release_id uuid NOT NULL,
  sense_key text NOT NULL, section varchar(64) NOT NULL,
  target_language text NOT NULL CHECK (target_language IN ('uk', 'de', 'en', 'vi')),
  policy_version varchar(500) NOT NULL,
  origin_kind text NOT NULL CHECK (origin_kind IN ('machine-translation', 'generated-unverified')),
  text text NOT NULL CHECK (length(text) <= 40000),
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  FOREIGN KEY (entry_id, release_id) REFERENCES klaro.lexical_entries(id, release_id) ON DELETE CASCADE,
  UNIQUE (entry_id, release_id, sense_key, section, target_language, policy_version, origin_kind)
);
CREATE TABLE klaro.reference_error_reports (
  id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES klaro.users(id) ON DELETE CASCADE,
  target_id uuid NOT NULL, target_kind text NOT NULL CHECK (target_kind IN ('reference', 'supplement')),
  reason text NOT NULL CHECK (reason IN ('wrong-sense', 'wrong-form', 'wrong-translation', 'rights', 'other')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reference_reports_rate ON klaro.reference_error_reports(user_id, created_at);
