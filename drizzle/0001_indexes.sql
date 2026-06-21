-- drizzle/0001_indexes.sql  (run after drizzle migrations; applied out-of-band)
CREATE INDEX IF NOT EXISTS chunks_embed_hnsw ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS entity_index_embed_hnsw ON entity_index USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS entity_index_trgm ON entity_index USING gin (search_text gin_trgm_ops);
