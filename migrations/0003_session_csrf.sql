ALTER TABLE klaro.sessions ADD COLUMN csrf_hash bytea;
ALTER TABLE klaro.sessions ADD CONSTRAINT session_csrf_hash_length CHECK (csrf_hash IS NULL OR octet_length(csrf_hash) = 32);
