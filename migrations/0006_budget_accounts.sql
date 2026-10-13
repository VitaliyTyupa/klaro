CREATE TABLE klaro.budget_accounts (
  scope_key varchar(128) NOT NULL,
  user_id uuid REFERENCES klaro.users(id) ON DELETE CASCADE,
  budget_day date NOT NULL,
  spent_tokens bigint NOT NULL DEFAULT 0 CHECK (spent_tokens >= 0),
  spent_cost_microusd bigint NOT NULL DEFAULT 0 CHECK (spent_cost_microusd >= 0),
  PRIMARY KEY (scope_key, budget_day),
  CHECK ((scope_key = 'global' AND user_id IS NULL) OR scope_key = 'user:' || user_id::text)
);
ALTER TABLE klaro.stage_attempts
  ADD COLUMN input_token_bound bigint NOT NULL DEFAULT 0 CHECK (input_token_bound >= 0),
  ADD COLUMN output_token_bound bigint NOT NULL DEFAULT 0 CHECK (output_token_bound >= 0),
  ADD COLUMN cost_bound_microusd bigint NOT NULL DEFAULT 0 CHECK (cost_bound_microusd >= 0);
