'use client'

import { useState } from 'react'

export default function Home() {
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<{role: string, content: string}[]>([])
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)

  async function sendMessage() {
    if (!message.trim()) return

    const userMessage = { role: 'user', content: message }
    setMessages(prev => [...prev, userMessage])
    setMessage('')
    setLoading(true)

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, conversationId })
    })

    const data = await response.json()
    if (data.conversationId) setConversationId(data.conversationId)
    setMessages(prev => [...prev, { role: 'assistant', content: data.reply }])
    setLoading(false)
  }

  return (
    <main style={{ maxWidth: '800px', margin: '0 auto', padding: '24px' }}>
      <h1 style={{ marginBottom: '24px' }}>Personal Health AI</h1>

      <div style={{
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        padding: '16px',
        minHeight: '400px',
        marginBottom: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}>
        {messages.length === 0 && (
          <p style={{ color: '#94a3b8' }}>Ask me anything about your health, fitness or wellness...</p>
        )}
        {messages.map((msg, i) => (
          <div key={i} style={{
            padding: '12px',
            borderRadius: '8px',
            background: msg.role === 'user' ? '#f0f9ff' : '#f8fafc',
            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '80%'
          }}>
            <strong>{msg.role === 'user' ? 'You' : 'Health AI'}</strong>
            <p style={{ margin: '4px 0 0 0' }}>{msg.content}</p>
          </div>
        ))}
        {loading && (
          <div style={{ color: '#94a3b8' }}>Health AI is thinking...</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          type="text"
          value={message}
          onChange={e => setMessage(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
          placeholder="Ask about your health..."
          style={{
            flex: 1,
            padding: '12px',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            fontSize: '16px'
          }}
        />
        <button
          onClick={sendMessage}
          disabled={loading}
          style={{
            padding: '12px 24px',
            borderRadius: '8px',
            background: '#0f766e',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            fontSize: '16px'
          }}
        >
          Send
        </button>
      </div>

      {conversationId && (
        <p style={{ marginTop: '8px', fontSize: '12px', color: '#94a3b8' }}>
          Conversation saved — ID: {conversationId}
        </p>
      )}
    </main>
  )
}