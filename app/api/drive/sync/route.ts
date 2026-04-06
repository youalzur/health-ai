import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'
import { VoyageAIClient } from 'voyageai'

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

export async function POST() {
  const { data: tokenRow } = await supabase
    .from('drive_tokens')
    .select('access_token, refresh_token, expiry_date, folder_id')
    .eq('id', 1)
    .single()

  if (!tokenRow?.refresh_token) {
    return NextResponse.json({ error: 'Not connected to Google Drive' }, { status: 401 })
  }
  if (!tokenRow.folder_id) {
    return NextResponse.json({ error: 'No folder configured' }, { status: 400 })
  }

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXT_PUBLIC_APP_URL}/api/drive/callback`
  )
  oauth2.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token,
    expiry_date: tokenRow.expiry_date,
  })

  // Persist refreshed tokens if they were rotated
  oauth2.on('tokens', async (tokens) => {
    await supabase.from('drive_tokens').upsert({
      id: 1,
      access_token: tokens.access_token,
      ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}),
      expiry_date: tokens.expiry_date,
    })
  })

  const drive = google.drive({ version: 'v3', auth: oauth2 })

  // List PDF and TXT files in the folder
  const { data: list } = await drive.files.list({
    q: `'${tokenRow.folder_id}' in parents and (mimeType='application/pdf' or mimeType='text/plain') and trashed=false`,
    fields: 'files(id,name,mimeType)',
    pageSize: 100,
  })

  const files = list.files ?? []
  if (files.length === 0) {
    return NextResponse.json({ synced: 0, skipped: 0 })
  }

  // Find which Drive file IDs are already indexed
  const driveIds = files.map((f) => f.id!)
  const { data: existing } = await supabase
    .from('documents')
    .select('drive_file_id')
    .in('drive_file_id', driveIds)

  const alreadyIndexed = new Set((existing ?? []).map((d) => d.drive_file_id))

  let synced = 0
  let skipped = 0

  for (const file of files) {
    if (alreadyIndexed.has(file.id!)) {
      skipped++
      continue
    }

    // Download file content
    const res = await drive.files.get(
      { fileId: file.id!, alt: 'media' },
      { responseType: 'arraybuffer' }
    )

    let text = ''
    if (file.mimeType === 'application/pdf') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
      text = (await pdfParse(Buffer.from(res.data as ArrayBuffer))).text
    } else {
      text = Buffer.from(res.data as ArrayBuffer).toString('utf-8')
    }

    if (!text.trim()) {
      skipped++
      continue
    }

    // Create document record
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .insert({ name: file.name, type: file.mimeType, drive_file_id: file.id })
      .select()
      .single()
    if (docError) throw docError

    // Chunk, embed, store
    const chunks = chunkText(text)
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await generateEmbedding(chunks[i])
      await supabase.from('document_chunks').insert({
        document_id: doc.id,
        content: chunks[i],
        chunk_index: i,
        embedding,
      })
    }

    synced++
  }

  await supabase
    .from('drive_tokens')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('id', 1)

  return NextResponse.json({ synced, skipped })
}
