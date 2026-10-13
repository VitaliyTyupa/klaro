ALTER TABLE klaro.operations ADD COLUMN error_code varchar(64);
ALTER TABLE klaro.operations ADD COLUMN error_retryable boolean NOT NULL DEFAULT false;
