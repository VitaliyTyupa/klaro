CREATE TABLE klaro.dataset_releases (
  id uuid PRIMARY KEY,
  source_id varchar(128) NOT NULL,
  source_revision varchar(200) NOT NULL,
  content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  manifest jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('staging', 'validated', 'revoked')),
  import_complete boolean NOT NULL DEFAULT false,
  coverage jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  UNIQUE (source_id, source_revision, content_sha256)
);
CREATE TABLE klaro.active_dataset (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  release_id uuid NOT NULL REFERENCES klaro.dataset_releases(id),
  activated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE klaro.source_records (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES klaro.dataset_releases(id) ON DELETE CASCADE,
  native_key text NOT NULL,
  fragment_path text NOT NULL,
  source_url text NOT NULL,
  source_revision varchar(200) NOT NULL,
  license text NOT NULL CHECK (license IN ('CC-BY-SA-4.0', 'CC0-1.0')),
  license_url text NOT NULL,
  attribution text NOT NULL,
  evidence_url text NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  UNIQUE (release_id, native_key, fragment_path),
  UNIQUE (id, release_id)
);
CREATE TABLE klaro.lexical_entries (
  id uuid PRIMARY KEY,
  release_id uuid NOT NULL REFERENCES klaro.dataset_releases(id) ON DELETE CASCADE,
  native_key text NOT NULL,
  language text NOT NULL CHECK (language IN ('uk', 'de', 'en', 'vi')),
  lemma text NOT NULL,
  normalized_lemma text NOT NULL,
  part_of_speech varchar(64) NOT NULL,
  homonym_key text NOT NULL,
  features jsonb NOT NULL DEFAULT '{}',
  source_record_id uuid NOT NULL,
  UNIQUE (release_id, native_key), UNIQUE (id, release_id),
  FOREIGN KEY (source_record_id, release_id) REFERENCES klaro.source_records(id, release_id)
);
CREATE INDEX lexical_entries_lookup ON klaro.lexical_entries(release_id, language, normalized_lemma);
CREATE TABLE klaro.lexical_senses (
  id uuid PRIMARY KEY, release_id uuid NOT NULL,
  entry_id uuid NOT NULL, position integer NOT NULL CHECK (position >= 0),
  glosses text[] NOT NULL, definition_language text NOT NULL, tags text[] NOT NULL,
  source_record_id uuid NOT NULL,
  UNIQUE (entry_id, position), UNIQUE (id, release_id),
  FOREIGN KEY (entry_id, release_id) REFERENCES klaro.lexical_entries(id, release_id) ON DELETE CASCADE,
  FOREIGN KEY (source_record_id, release_id) REFERENCES klaro.source_records(id, release_id)
);
CREATE TABLE klaro.lexical_translations (
  id uuid PRIMARY KEY, release_id uuid NOT NULL, entry_id uuid NOT NULL,
  sense_id uuid, language text NOT NULL, text text NOT NULL,
  source_sense_label text, source_record_id uuid NOT NULL,
  FOREIGN KEY (entry_id, release_id) REFERENCES klaro.lexical_entries(id, release_id) ON DELETE CASCADE,
  FOREIGN KEY (sense_id, release_id) REFERENCES klaro.lexical_senses(id, release_id) ON DELETE CASCADE,
  FOREIGN KEY (source_record_id, release_id) REFERENCES klaro.source_records(id, release_id)
);
CREATE TABLE klaro.lexical_examples (
  id uuid PRIMARY KEY, release_id uuid NOT NULL, sense_id uuid NOT NULL,
  text text NOT NULL, language text NOT NULL, source_record_id uuid NOT NULL,
  FOREIGN KEY (sense_id, release_id) REFERENCES klaro.lexical_senses(id, release_id) ON DELETE CASCADE,
  FOREIGN KEY (source_record_id, release_id) REFERENCES klaro.source_records(id, release_id)
);
CREATE TABLE klaro.lexical_inflections (
  id uuid PRIMARY KEY, release_id uuid NOT NULL, entry_id uuid NOT NULL,
  form text NOT NULL, normalized_form text NOT NULL, tags text[] NOT NULL,
  source_record_id uuid NOT NULL,
  FOREIGN KEY (entry_id, release_id) REFERENCES klaro.lexical_entries(id, release_id) ON DELETE CASCADE,
  FOREIGN KEY (source_record_id, release_id) REFERENCES klaro.source_records(id, release_id)
);
CREATE INDEX lexical_inflections_lookup ON klaro.lexical_inflections(release_id, normalized_form);
CREATE INDEX lexical_senses_entry ON klaro.lexical_senses(entry_id);
CREATE INDEX lexical_translations_entry ON klaro.lexical_translations(entry_id);
CREATE INDEX lexical_examples_sense ON klaro.lexical_examples(sense_id);
CREATE TABLE klaro.reference_takedowns (
  id uuid PRIMARY KEY, source_id varchar(128) NOT NULL,
  native_key text, content_hash char(64), reason varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (native_key IS NOT NULL OR content_hash IS NOT NULL)
);
CREATE VIEW klaro.admitted_lexical_entries AS
SELECT e.* FROM klaro.lexical_entries e
JOIN klaro.active_dataset a ON a.release_id = e.release_id
JOIN klaro.dataset_releases d ON d.id = e.release_id AND d.state = 'validated'
WHERE NOT EXISTS (SELECT 1 FROM klaro.reference_takedowns t
  JOIN klaro.source_records s ON s.release_id = e.release_id AND s.native_key = e.native_key
  WHERE t.source_id = d.source_id AND (t.native_key = e.native_key OR t.content_hash = s.content_hash));
CREATE TABLE klaro.reference_update_checks (
  source_id varchar(128) PRIMARY KEY, checked_at timestamptz NOT NULL,
  metadata_sha256 char(64) NOT NULL, changed boolean NOT NULL
);
