-- Documents table: stores file metadata
create table if not exists documents (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  type        text not null,
  created_at  timestamptz default now()
);

-- Document chunks table: stores chunked text with embeddings
create table if not exists document_chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid references documents(id) on delete cascade,
  content      text not null,
  chunk_index  int not null,
  embedding    vector(512),
  created_at   timestamptz default now()
);

-- HNSW index for fast cosine similarity search on chunks
create index if not exists document_chunks_embedding_idx
  on document_chunks using hnsw (embedding vector_cosine_ops);

-- Similarity search function for document chunks
create or replace function match_document_chunks(
  query_embedding  vector(512),
  match_threshold  float,
  match_count      int
)
returns table (
  id           uuid,
  document_id  uuid,
  content      text,
  similarity   float
)
language sql stable
as $$
  select
    document_chunks.id,
    document_chunks.document_id,
    document_chunks.content,
    1 - (document_chunks.embedding <=> query_embedding) as similarity
  from document_chunks
  where document_chunks.embedding is not null
    and 1 - (document_chunks.embedding <=> query_embedding) > match_threshold
  order by document_chunks.embedding <=> query_embedding
  limit match_count;
$$;
