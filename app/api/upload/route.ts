import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

async function generateEmbedding(text: string): Promise<number[]> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ input: [text], model: 'voyage-3-lite' }),
  })
  const data = await res.json()
  const embedding = data.data?.[0]?.embedding
  if (!embedding) throw new Error('Failed to generate embedding')
  return embedding
}

// Split text into overlapping word-based chunks
function chunkText(text: string, chunkSize = 400, overlap = 50): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const chunks: string[] = []
  let i = 0
  while (i < words.length) {
    chunks.push(words.slice(i, i + chunkSize).join(' '))
    if (i + chunkSize >= words.length) break
    i += chunkSize - overlap
  }
  return chunks
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Extract text based on file type
    let text = ''
    if (file.type === 'application/pdf') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
      const buffer = Buffer.from(await file.arrayBuffer())
      const pdf = await pdfParse(buffer)
      text = pdf.text
    } else if (file.type === 'text/plain') {
      text = await file.text()
    } else {
      return NextResponse.json(
        { error: 'Unsupported file type. Please upload a PDF or TXT file.' },
        { status: 400 }
      )
    }

    if (!text.trim()) {
      return NextResponse.json({ error: 'No text could be extracted from the file.' }, { status: 400 })
    }

    // Create document record
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .insert({ name: file.name, type: file.type })
      .select()
      .single()
    if (docError) throw docError

    // Chunk, embed, and store each chunk
    const chunks = chunkText(text)
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await generateEmbedding(chunks[i])
      const { error } = await supabase.from('document_chunks').insert({
        document_id: doc.id,
        content: chunks[i],
        chunk_index: i,
        embedding,
      })
      if (error) throw error
    }

    return NextResponse.json({ documentId: doc.id, name: file.name, chunks: chunks.length })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
