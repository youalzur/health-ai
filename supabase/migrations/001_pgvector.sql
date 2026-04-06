-- Step 1: Enable the pgvector extension
create extension if not exists vector with schema extensions;

-- Step 2: Add embedding column to messages (voyage-3-lite produces 512-dim vectors)
alter table messages add column if not exists embedding vector(512);

-- Step 3: HNSW index for fast cosine similarity search
create index if not exists messages_embedding_idx
  on messages using hnsw (embedding vector_cosine_ops);

-- Step 4: Similarity search function used by the RAG pipeline
-- Returns messages from past conversations (excluding the current one)
-- ordered by cosine similarity to the query embedding.
create or replace function match_messages(
  query_embedding  vector(512),
  match_threshold  float,
  match_count      int,
  exclude_conversation_id uuid
)
returns table (
  id               uuid,
  conversation_id  uuid,
  role             text,
  content          text,
  similarity       float
)
language sql stable
as $$
  select
    messages.id,
    messages.conversation_id,
    messages.role,
    messages.content,
    1 - (messages.embedding <=> query_embedding) as similarity
  from messages
  where messages.embedding is not null
    and messages.conversation_id != exclude_conversation_id
    and 1 - (messages.embedding <=> query_embedding) > match_threshold
  order by messages.embedding <=> query_embedding
  limit match_count;
$$;
