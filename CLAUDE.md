# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start development server at localhost:3000
npm run build    # Production build
npm run lint     # Run ESLint
```

There are no tests configured in this project.

## Environment Variables

Required in `.env.local`:
- `ANTHROPIC_API_KEY` — Anthropic API key for Claude
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon/public key
- `VOYAGE_API_KEY` — Voyage AI API key for generating message embeddings (get one at voyageai.com)
- `GOOGLE_CLIENT_ID` — Google OAuth client ID
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — same value, exposed to browser for Drive Picker
- `GOOGLE_CLIENT_SECRET` — Google OAuth client secret
- `GOOGLE_API_KEY` — Google API key (server-side)
- `NEXT_PUBLIC_GOOGLE_API_KEY` — same value, exposed to browser for Drive Picker widget
- `NEXT_PUBLIC_APP_URL` — app base URL (e.g. `http://localhost:3000`), used for OAuth redirect URI

## Architecture

**Next.js 16 App Router** app with a single chat page and one API route.

### Data Flow

`app/page.tsx` (client component) holds chat UI state (`messages`, `conversationId`). On send, it POSTs to `/api/chat` with the message and the current `conversationId` (null on first message).

`app/api/chat/route.ts` (server-side POST handler):
1. If no `conversationId`, creates a new row in the Supabase `conversations` table (title = first 50 chars of message)
2. Inserts the user message into `messages`
3. Fetches full message history for the conversation from Supabase (ordered by `created_at`)
4. Sends the entire history to Claude (`claude-sonnet-4-6`) with system prompt `"You are a personal health assistant."`
5. Inserts the assistant reply into `messages`
6. Returns `{ reply, conversationId }` to the client

### Supabase Schema

Two tables:
- `conversations` — `id`, `title`, `created_at`
- `messages` — `id`, `conversation_id` (FK), `role` (`user`|`assistant`), `content`, `embedding vector(512)`, `created_at`

Conversation history is persisted entirely in Supabase; the client only tracks the active `conversationId` in React state (lost on page refresh — no session persistence yet).

### Long-term Memory / RAG Pipeline (Phase 5)

Every message (both user and assistant) gets a 512-dimensional embedding via Voyage AI (`voyage-3-lite`) stored in the `embedding` column.

Before each Claude call, the API route runs a pgvector cosine similarity search (`match_messages` SQL function) against all messages **outside** the current conversation. Any matches above the 0.6 similarity threshold (up to 5) are injected into the system prompt as `Relevant context from past conversations`. This lets Claude recall health information shared in previous sessions.

The SQL migration that sets up pgvector, adds the `embedding` column, the HNSW index, and the `match_messages` function lives in `supabase/migrations/001_pgvector.sql` — run it once in the Supabase SQL editor.
