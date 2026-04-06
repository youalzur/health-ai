'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

type Document = { id: string; name: string; created_at: string }
type DriveStatus = {
  connected: boolean
  folderId?: string
  folderName?: string
  fileCount?: number
  lastSyncedAt?: string
}

declare global {
  interface Window {
    gapi: {
      load: (lib: string, cb: () => void) => void
      client: { init: (opts: object) => Promise<void> }
    }
    google: {
      picker: {
        PickerBuilder: new () => PickerBuilder
        ViewId: { FOLDERS: string }
        Feature: { NAV_HIDDEN: string; MINE_ONLY: string }
        Action: { PICKED: string; CANCEL: string }
      }
    }
    tokenClient: { requestAccessToken: (opts: { callback: (r: { access_token: string }) => void }) => void }
  }
}

interface PickerBuilder {
  addView: (view: object) => PickerBuilder
  enableFeature: (f: string) => PickerBuilder
  setOAuthToken: (token: string) => PickerBuilder
  setDeveloperKey: (key: string) => PickerBuilder
  setCallback: (cb: (data: PickerResult) => void) => PickerBuilder
  setTitle: (title: string) => PickerBuilder
  build: () => { setVisible: (v: boolean) => void }
}

interface PickerResult {
  action: string
  docs?: Array<{ id: string; name: string }>
}

export default function Home() {
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)

  const [documents, setDocuments] = useState<Document[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<{ text: string; ok: boolean } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [driveStatus, setDriveStatus] = useState<DriveStatus | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ text: string; ok: boolean } | null>(null)
  const [pickerReady, setPickerReady] = useState(false)

  useEffect(() => {
    fetchDocuments()
    fetchDriveStatus()

    // Load the Google API scripts
    const gapiScript = document.createElement('script')
    gapiScript.src = 'https://apis.google.com/js/api.js'
    gapiScript.onload = () => {
      window.gapi.load('picker', () => setPickerReady(true))
    }
    document.body.appendChild(gapiScript)

    const gsiScript = document.createElement('script')
    gsiScript.src = 'https://accounts.google.com/gsi/client'
    document.body.appendChild(gsiScript)

    // Handle redirect params
    const params = new URLSearchParams(window.location.search)
    if (params.get('drive_connected')) {
      fetchDriveStatus()
      window.history.replaceState({}, '', '/')
    }
  }, [])

  async function fetchDocuments() {
    const res = await fetch('/api/documents')
    const data = await res.json()
    if (data.documents) setDocuments(data.documents)
  }

  async function fetchDriveStatus() {
    const res = await fetch('/api/drive/status')
    const data = await res.json()
    setDriveStatus(data)
  }

  const openFolderPicker = useCallback(() => {
    // Get a short-lived access token via the token client
    const tokenClient = (window as unknown as { google: { accounts: { oauth2: { initTokenClient: (opts: object) => { requestAccessToken: (opts: object) => void } } } } }).google.accounts.oauth2.initTokenClient({
      client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      callback: (response: { access_token: string }) => {
        const view = new window.google.picker.PickerBuilder()
          .addView(
            Object.assign(
              new (window as unknown as { google: { picker: { DocsView: new (viewId: string) => object } } }).google.picker.DocsView(
                window.google.picker.ViewId.FOLDERS
              ),
              { setSelectFolderEnabled: true, setMimeTypes: 'application/vnd.google-apps.folder' }
            )
          )
          .enableFeature(window.google.picker.Feature.NAV_HIDDEN)
          .setOAuthToken(response.access_token)
          .setDeveloperKey(process.env.NEXT_PUBLIC_GOOGLE_API_KEY!)
          .setTitle('Select a health records folder')
          .setCallback(async (data: PickerResult) => {
            if (data.action === window.google.picker.Action.PICKED && data.docs?.[0]) {
              const { id, name } = data.docs[0]
              await fetch('/api/drive/folder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderId: id, folderName: name }),
              })
              fetchDriveStatus()
            }
          })
          .build()
        view.setVisible(true)
      },
    })
    tokenClient.requestAccessToken({ prompt: '' })
  }, [pickerReady])

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadStatus(null)

    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch('/api/upload', { method: 'POST', body: formData })
    const data = await res.json()

    if (res.ok) {
      setUploadStatus({ text: `"${data.name}" uploaded — ${data.chunks} chunks indexed`, ok: true })
      fetchDocuments()
    } else {
      setUploadStatus({ text: data.error ?? 'Upload failed', ok: false })
    }

    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSync() {
    setSyncing(true)
    setSyncResult(null)
    const res = await fetch('/api/drive/sync', { method: 'POST' })
    const data = await res.json()
    if (res.ok) {
      setSyncResult({
        text: `Synced ${data.synced} new file${data.synced !== 1 ? 's' : ''}, ${data.skipped} already indexed`,
        ok: true,
      })
      fetchDocuments()
      fetchDriveStatus()
    } else {
      setSyncResult({ text: data.error ?? 'Sync failed', ok: false })
    }
    setSyncing(false)
  }

  async function sendMessage() {
    if (!message.trim()) return

    const userMessage = { role: 'user', content: message }
    setMessages(prev => [...prev, userMessage])
    setMessage('')
    setLoading(true)

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, conversationId }),
    })

    const data = await response.json()
    if (data.conversationId) setConversationId(data.conversationId)
    setMessages(prev => [...prev, { role: 'assistant', content: data.reply }])
    setLoading(false)
  }

  return (
    <main style={{ maxWidth: '800px', margin: '0 auto', padding: '24px' }}>
      <h1 style={{ marginBottom: '24px' }}>Personal Health AI</h1>

      {/* Document upload */}
      <div style={{
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '16px',
        background: '#f8fafc',
      }}>
        <h2 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: 600 }}>Health Documents</h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt"
            onChange={handleFileUpload}
            disabled={uploading}
            style={{ fontSize: '14px' }}
          />
          {uploading && <span style={{ color: '#94a3b8', fontSize: '14px' }}>Uploading...</span>}
        </div>

        {uploadStatus && (
          <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: uploadStatus.ok ? '#0f766e' : '#dc2626' }}>
            {uploadStatus.text}
          </p>
        )}

        {documents.length > 0 && (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {documents.map(doc => (
              <li key={doc.id} style={{ fontSize: '13px', color: '#64748b' }}>
                📄 {doc.name}
              </li>
            ))}
          </ul>
        )}

        {documents.length === 0 && !uploading && (
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
            No documents yet. Upload a PDF or TXT health record to give the AI context.
          </p>
        )}
      </div>

      {/* Google Drive */}
      <div style={{
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '24px',
        background: '#f8fafc',
      }}>
        <h2 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: 600 }}>Google Drive</h2>

        {driveStatus === null && (
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>Loading...</p>
        )}

        {driveStatus && !driveStatus.connected && (
          <div>
            <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#64748b' }}>
              Connect Google Drive to sync health records directly from a folder.
            </p>
            <a
              href="/api/drive/auth"
              style={{
                display: 'inline-block',
                padding: '8px 16px',
                borderRadius: '6px',
                background: '#4285f4',
                color: 'white',
                fontSize: '14px',
                textDecoration: 'none',
                fontWeight: 500,
              }}
            >
              Connect Google Drive
            </a>
          </div>
        )}

        {driveStatus?.connected && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', color: '#0f766e', fontWeight: 500 }}>Connected</span>
              {driveStatus.folderName ? (
                <span style={{ fontSize: '13px', color: '#64748b' }}>
                  — folder: <strong>{driveStatus.folderName}</strong>
                  {typeof driveStatus.fileCount === 'number' && ` (${driveStatus.fileCount} file${driveStatus.fileCount !== 1 ? 's' : ''} indexed)`}
                </span>
              ) : (
                <span style={{ fontSize: '13px', color: '#94a3b8' }}>— no folder selected yet</span>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={openFolderPicker}
                disabled={!pickerReady}
                style={{
                  padding: '7px 14px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: 'white',
                  fontSize: '13px',
                  cursor: pickerReady ? 'pointer' : 'default',
                  color: '#334155',
                }}
              >
                {driveStatus.folderName ? 'Change folder' : 'Select folder'}
              </button>

              {driveStatus.folderId && (
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  style={{
                    padding: '7px 14px',
                    borderRadius: '6px',
                    background: '#0f766e',
                    border: 'none',
                    color: 'white',
                    fontSize: '13px',
                    cursor: syncing ? 'default' : 'pointer',
                    fontWeight: 500,
                  }}
                >
                  {syncing ? 'Syncing...' : 'Sync now'}
                </button>
              )}
            </div>

            {syncResult && (
              <p style={{ margin: 0, fontSize: '13px', color: syncResult.ok ? '#0f766e' : '#dc2626' }}>
                {syncResult.text}
              </p>
            )}

            {driveStatus.lastSyncedAt && !syncResult && (
              <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>
                Last synced: {new Date(driveStatus.lastSyncedAt).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Chat */}
      <div style={{
        border: '1px solid #e2e8f0',
        borderRadius: '8px',
        padding: '16px',
        minHeight: '400px',
        marginBottom: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
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
            maxWidth: '80%',
          }}>
            <strong>{msg.role === 'user' ? 'You' : 'Health AI'}</strong>
            <p style={{ margin: '4px 0 0 0' }}>{msg.content}</p>
          </div>
        ))}
        {loading && <div style={{ color: '#94a3b8' }}>Health AI is thinking...</div>}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          suppressHydrationWarning
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
            fontSize: '16px',
          }}
        />
        <button
          suppressHydrationWarning
          onClick={sendMessage}
          disabled={loading}
          style={{
            padding: '12px 24px',
            borderRadius: '8px',
            background: '#0f766e',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            fontSize: '16px',
          }}
        >
          Send
        </button>
      </div>
    </main>
  )
}
