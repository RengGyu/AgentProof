-- Repository-scoped LLM mode. Existing rows remain NULL so the worker can
-- safely identify public legacy repositories from GitHub without treating a
-- private connection as consented.
alter table public.agentproof_tenant_repository_grants
  add column if not exists llm_analysis_mode text
  check (llm_analysis_mode in ('essential', 'enhanced'));
