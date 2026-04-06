import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { VoyageAIClient } from 'voyageai'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)
const voyage = new VoyageAIClient({ apiKey: process.env.VOYAGE_API_KEY! })

async function generateEmbedding(text: string): Promise<number[]> {
  const response = await voyage.embed({ input: [text], model: 'voyage-3-lite' })
  const embedding = response.data?.[0]?.embedding
  if (!embedding) throw new Error('Failed to generate embedding')
  return embedding
}

export async function POST(req: NextRequest) {
  try {
    const { message, conversationId } = await req.json()
    let convId = conversationId

    if (!convId) {
      const { data, error } = await supabase
        .from('conversations')
        .insert({ title: message.slice(0, 50) })
        .select()
        .single()
      if (error) throw error
      convId = data.id
    }

    // Generate embedding for the user message and save with it
    const userEmbedding = await generateEmbedding(message)
    await supabase.from('messages').insert({
      conversation_id: convId,
      role: 'user',
      content: message,
      embedding: userEmbedding,
    })

    // Retrieve semantically similar messages from past conversations (long-term memory)
    // and relevant document chunks — run in parallel
    const [{ data: memories }, { data: docChunks }] = await Promise.all([
      supabase.rpc('match_messages', {
        query_embedding: userEmbedding,
        match_threshold: 0.6,
        match_count: 5,
        exclude_conversation_id: convId,
      }),
      supabase.rpc('match_document_chunks', {
        query_embedding: userEmbedding,
        match_threshold: 0.6,
        match_count: 5,
      }),
    ])

    // Fetch the full message history for the current conversation
    const { data: history } = await supabase
      .from('messages')
      .select('role, content')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })

    // Build system prompt, injecting memories and document context
    let systemPrompt = 'You are a personal health assistant.'
    if (docChunks && docChunks.length > 0) {
      const docBlock = docChunks
        .map((c: { content: string }) => c.content)
        .join('\n\n')
      systemPrompt += '\n\nRelevant information from uploaded health documents:\n' + docBlock
    }
    if (memories && memories.length > 0) {
      const memoryBlock = memories
        .map((m: { role: string; content: string }) =>
          `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
        )
        .join('\n')
      systemPrompt += '\n\nRelevant context from past conversations:\n' + memoryBlock
    }

    const messages = (history ?? []).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content as string,
    }))

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    })

    const reply =
      response.content[0].type === 'text' ? response.content[0].text : ''

    // Generate embedding for the assistant reply and save with it
    const assistantEmbedding = await generateEmbedding(reply)
    await supabase.from('messages').insert({
      conversation_id: convId,
      role: 'assistant',
      content: reply,
      embedding: assistantEmbedding,
    })

    return NextResponse.json({ reply, conversationId: convId })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ reply: 'Error: ' + String(error) }, { status: 500 })
  }
}
