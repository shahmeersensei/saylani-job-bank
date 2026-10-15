-- Semantic embeddings table (Phase 3). Requires the pgvector extension.
-- On plain Postgres installs without pgvector, this migration is a no-op.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE IF NOT EXISTS embeddings (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      entity_type TEXT        NOT NULL,
      entity_id   UUID        NOT NULL,
      model       TEXT        NOT NULL,
      content     TEXT        NOT NULL,
      embedding   vector(384),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS embeddings_entity_model_uq ON embeddings (entity_type, entity_id, model);
  END IF;
END;
$$;
