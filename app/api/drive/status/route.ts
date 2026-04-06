import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET() {
  const { data } = await supabase
    .from('drive_tokens')
    .select('folder_id, folder_name, last_synced_at')
    .eq('id', 1)
    .single()

  if (!data) return NextResponse.json({ connected: false })

  const { count } = await supabase
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .not('drive_file_id', 'is', null)

  return NextResponse.json({
    connected: true,
    folderId: data.folder_id,
    folderName: data.folder_name,
    fileCount: count ?? 0,
    lastSyncedAt: data.last_synced_at,
  })
}
