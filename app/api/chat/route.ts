import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

export async function POST(req: NextRequest) {
  try {
    const { message } = await req.json()
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: 'You are a personal health assistant.',
      messages: [{ role: 'user', content: message }]
    })
    const reply = response.content[0].type === 'text' ? response.content[0].text : ''
    return NextResponse.json({ reply })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json({ reply: 'Error: ' + String(error) }, { status: 500 })
  }
}
