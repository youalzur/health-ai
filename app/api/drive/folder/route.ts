import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  const { folderId, folderName } = await req.json()
  if (!folderId) return NextResponse.json({ error: 'Missing folderId' }, { status: 400 })

  const { data: tokenRow } = await supabase
    .from('drive_tokens')
    .select('access_token, refresh_token, expiry_date')
    .eq('id', 1)
    .single()

  if (!tokenRow?.refresh_token) {
    return NextResponse.json({ error: 'Not connected to Google Drive' }, { status: 401 })
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

  // Verify the folder exists and is accessible
  const drive = google.drive({ version: 'v3', auth: oauth2 })
  const { data: folder } = await drive.files.get({ fileId: folderId, fields: 'id,name' })

  const resolvedName = folderName ?? folder.name ?? folderId

  await supabase.from('drive_tokens').upsert({
    id: 1,
    folder_id: folderId,
    folder_name: resolvedName,
  })

  return NextResponse.json({ folderId, folderName: resolvedName })
}
