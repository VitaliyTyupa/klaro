CREATE TABLE klaro.operation_feedback (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES klaro.users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL REFERENCES klaro.operations(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('helpful','meaning','grammar','translation','style','other')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, operation_id)
);
CREATE INDEX operation_feedback_user_created ON klaro.operation_feedback(user_id, created_at);
