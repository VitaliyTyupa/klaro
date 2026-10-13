CREATE TABLE klaro.operations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES klaro.users(id) ON DELETE CASCADE,
  client_request_id varchar(128) NOT NULL,
  revision_id varchar(128) NOT NULL,
  operation_type text NOT NULL CHECK (operation_type IN ('correction', 'paraphrase', 'alternatives', 'explanation', 'back-translation', 'translation', 'lexical-supplement', 'source-translation')),
  status text NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'running', 'partially-completed', 'completed', 'failed', 'cancelled', 'indeterminate')),
  payload_digest bytea CHECK (payload_digest IS NULL OR octet_length(payload_digest) = 32),
  digest_expires_at timestamptz NOT NULL,
  payload_expires_at timestamptz NOT NULL,
  workflow_version varchar(128) NOT NULL,
  model_policy_version varchar(128) NOT NULL,
  prompt_policy_version varchar(128) NOT NULL,
  input_code_points integer NOT NULL CHECK (input_code_points >= 0 AND input_code_points <= 20000),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  result_version integer NOT NULL DEFAULT 0 CHECK (result_version >= 0),
  parent_operation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  cancel_requested_at timestamptz,
  UNIQUE (user_id, client_request_id),
  UNIQUE (id, user_id),
  FOREIGN KEY (parent_operation_id, user_id) REFERENCES klaro.operations(id, user_id)
);
CREATE INDEX operations_user_created ON klaro.operations(user_id, created_at);
CREATE INDEX operations_running ON klaro.operations(status) WHERE status IN ('accepted', 'running', 'partially-completed');

CREATE TABLE klaro.stage_attempts (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  stage_id varchar(128) NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  status text NOT NULL CHECK (status IN ('prepared', 'dispatched', 'completed', 'failed', 'cancelled', 'indeterminate')),
  provider_request_id varchar(256),
  model_policy_version varchar(128) NOT NULL,
  prompt_policy_version varchar(128) NOT NULL,
  dispatched_at timestamptz,
  completed_at timestamptz,
  error_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (operation_id, user_id) REFERENCES klaro.operations(id, user_id) ON DELETE CASCADE,
  UNIQUE (operation_id, stage_id, attempt_number),
  UNIQUE (id, operation_id, user_id)
);

CREATE TABLE klaro.usage_ledger (
  id uuid PRIMARY KEY,
  stage_attempt_id uuid NOT NULL UNIQUE,
  operation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  input_tokens bigint NOT NULL CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL CHECK (output_tokens >= 0),
  cost_microusd bigint NOT NULL CHECK (cost_microusd >= 0),
  usage_kind text NOT NULL CHECK (usage_kind IN ('actual', 'estimated')),
  price_policy_version varchar(128) NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (stage_attempt_id, operation_id, user_id) REFERENCES klaro.stage_attempts(id, operation_id, user_id) ON DELETE CASCADE
);
CREATE INDEX usage_ledger_user_settled ON klaro.usage_ledger(user_id, settled_at);

CREATE TABLE klaro.budget_reservations (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  budget_day date NOT NULL,
  reserved_tokens bigint NOT NULL CHECK (reserved_tokens >= 0),
  reserved_cost_microusd bigint NOT NULL CHECK (reserved_cost_microusd >= 0),
  remaining_tokens bigint NOT NULL CHECK (remaining_tokens >= 0 AND remaining_tokens <= reserved_tokens),
  remaining_cost_microusd bigint NOT NULL CHECK (remaining_cost_microusd >= 0 AND remaining_cost_microusd <= reserved_cost_microusd),
  state text NOT NULL CHECK (state IN ('reserved', 'settled', 'released', 'unknown')),
  budget_policy_version varchar(128) NOT NULL,
  price_policy_version varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (operation_id, user_id) REFERENCES klaro.operations(id, user_id) ON DELETE CASCADE
);
CREATE INDEX budget_reservations_day ON klaro.budget_reservations(budget_day, state);
