CREATE TABLE klaro.account_deletion_tombstones (
  user_id uuid PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT now(),
  cleaned_at timestamptz,
  retain_until timestamptz NOT NULL DEFAULT now() + interval '35 days'
);
CREATE INDEX account_deletion_cleanup ON klaro.account_deletion_tombstones(requested_at) WHERE cleaned_at IS NULL;
