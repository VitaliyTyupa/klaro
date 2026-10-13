CREATE TABLE klaro.users (
  id uuid PRIMARY KEY,
  display_name varchar(200),
  email varchar(320),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleting', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE klaro.external_identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES klaro.users(id) ON DELETE CASCADE,
  issuer varchar(2048) NOT NULL,
  subject varchar(512) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject)
);
CREATE INDEX external_identities_user_id ON klaro.external_identities(user_id);

CREATE TABLE klaro.sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES klaro.users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  client_kind text NOT NULL CHECK (client_kind IN ('web', 'extension')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_id ON klaro.sessions(user_id);

CREATE TABLE klaro.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES klaro.users(id) ON DELETE CASCADE,
  contract_version text NOT NULL DEFAULT 'v1' CHECK (contract_version = 'v1'),
  native_language text NOT NULL DEFAULT 'uk' CHECK (native_language IN ('uk', 'de', 'en', 'vi')),
  writing_languages text[] NOT NULL DEFAULT ARRAY['de']::text[],
  active_writing_language text NOT NULL DEFAULT 'de' CHECK (active_writing_language IN ('uk', 'de', 'en', 'vi')),
  style text NOT NULL DEFAULT 'neutral' CHECK (style IN ('neutral', 'formal')),
  proficiency text CHECK (proficiency IN ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(writing_languages) BETWEEN 1 AND 3),
  CHECK (array_position(writing_languages, NULL) IS NULL),
  CHECK (writing_languages <@ ARRAY['uk', 'de', 'en', 'vi']::text[]),
  CHECK (NOT native_language = ANY(writing_languages)),
  CHECK (active_writing_language = ANY(writing_languages)),
  CHECK (cardinality(array_positions(writing_languages, 'uk')) <= 1
    AND cardinality(array_positions(writing_languages, 'de')) <= 1
    AND cardinality(array_positions(writing_languages, 'en')) <= 1
    AND cardinality(array_positions(writing_languages, 'vi')) <= 1)
);
