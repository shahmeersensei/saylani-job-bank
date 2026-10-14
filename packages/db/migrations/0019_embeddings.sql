-- Semantic embeddings table (Phase 3). Requires the pgvector extension.
-- On plain Postgres installs without pgvector, skip this migration.
-- See docker/Dockerfile.postgres for a PostGIS + pgvector image.

CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"model" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(384),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "embeddings_entity_model_uq" ON "embeddings" USING btree ("entity_type", "entity_id", "model");
--> statement-breakpoint
CREATE INDEX "embeddings_hnsw_idx" ON "embeddings" USING hnsw ("embedding" vector_cosine_ops);
