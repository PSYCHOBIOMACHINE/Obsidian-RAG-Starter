-- enable pgvector extension
create extension if not exists vector;

-- Drop and recreate the table
DROP TABLE IF EXISTS vault_chunks CASCADE;
CREATE TABLE vault_chunks (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text,
  topic       text,
  type        text,
  title       text,
  emtags      text[]  DEFAULT '{}',
  chunk_index int     DEFAULT 0,
  content     text,
  embedding   vector(2048)
);

-- Row Level Security: allow anon (client-facing) reads via the anon key.
-- Without this, match_chunks silently returns zero rows when called
-- with NEXT_PUBLIC_SUPABASE_ANON_KEY, even though data exists.
ALTER TABLE vault_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access"
ON vault_chunks FOR SELECT
TO anon
USING (true);

-- DROP first so Postgres allows the return type change
DROP FUNCTION IF EXISTS match_chunks(vector(2048), int);
CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding vector(2048),
  match_count     int
)
RETURNS TABLE(
  source      text,
  topic       text,
  type        text,
  title       text,
  emtags      text[],
  chunk_index int,
  content     text,
  similarity  float
)
LANGUAGE sql AS $$
  SELECT source, topic, type, title, emtags, chunk_index, content,
    1 - (embedding <=> query_embedding) AS similarity
  FROM vault_chunks
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;