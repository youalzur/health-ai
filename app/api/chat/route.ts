import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

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

    await supabase.from('messages').insert({
      conversation_id: convId,
      role: 'user',
      content: message
    })

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: 'You are a personal health assistant.',
      messages: [{ role: 'user', content: message }]
    })

    const reply = response.content[0].type === 'text' ? response.content[0].text : ''

    await supabase.from('messages').insert({
      conversation_id: convId,
      role: 'assistant',
      content: reply
    })

    return NextResponse.json({ reply, conversationId: convId })

  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ reply: 'Error: ' + String(error) }, { status: 500 })
  }
}