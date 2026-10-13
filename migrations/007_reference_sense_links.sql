ALTER TABLE klaro.lexical_senses ADD UNIQUE (id, entry_id, release_id);
ALTER TABLE klaro.lexical_translations ADD FOREIGN KEY (sense_id, entry_id, release_id) REFERENCES klaro.lexical_senses(id, entry_id, release_id) ON DELETE CASCADE;
CREATE INDEX source_records_takedown ON klaro.source_records(release_id, native_key, content_hash);
