/** サーバー側フォルダにあるプロジェクトファイルへの出入り口。自作ファイルエクスプローラーが使う。 */

export interface ServerFileInfo {
  name: string
  size: number
  modified: number
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: unknown }
    if (typeof body.error === 'string') return body.error
  } catch {
    /* JSON でない応答は HTTP ステータスで表す */
  }
  return `HTTP ${response.status}`
}

export async function listServerFiles(): Promise<ServerFileInfo[]> {
  const response = await fetch('/api/files')
  if (!response.ok) throw new Error(await readError(response))
  const body = await response.json() as { files?: ServerFileInfo[] }
  return Array.isArray(body.files) ? body.files : []
}

export async function readServerFile(name: string): Promise<string> {
  const response = await fetch(`/api/files/${encodeURIComponent(name)}`)
  if (!response.ok) throw new Error(await readError(response))
  return response.text()
}

export async function writeServerFile(name: string, content: string): Promise<void> {
  const response = await fetch(`/api/files/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: content,
  })
  if (!response.ok) throw new Error(await readError(response))
}

export async function deleteServerFile(name: string): Promise<void> {
  const response = await fetch(`/api/files/${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (!response.ok) throw new Error(await readError(response))
}

export async function renameServerFile(name: string, to: string): Promise<void> {
  const response = await fetch(`/api/files/${encodeURIComponent(name)}/rename`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to }),
  })
  if (!response.ok) throw new Error(await readError(response))
}
