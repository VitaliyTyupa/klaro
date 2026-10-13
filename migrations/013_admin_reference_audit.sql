ALTER TABLE klaro.admin_audit DROP CONSTRAINT admin_audit_action_check;
ALTER TABLE klaro.admin_audit ADD CONSTRAINT admin_audit_action_check CHECK (action IN (
  'ai-enabled','ai-disabled','metrics-read','model-activate',
  'reference-import','reference-validate','reference-activate','reference-rollback',
  'reference-takedown','reference-revoke-source','reference-check'
));
