/** ホームディレクトリ配下を辿るための読み取り専用 API への出入り口。
 *  「プロジェクトを開く」画面の自作ファイルエクスプローラーが使う。
 *  projects フォルダ限定の serverFiles.ts とは別に、PC 内の好きな場所から
 *  .json プロジェクトファイルを探して開けるようにするためのもの。 */

export interface BrowseEntry {
  name: string
  type: 'dir' | 'file'
  size: number
  modified: number
}

export interface BrowseResult {
  /** ホームディレクトリからの相対パス。ホーム自身なら空文字。 */
  dir: string
  /** 一つ上のフォルダへの相対パス。ホーム自身なら null（これ以上は上がれない）。 */
  parent: string | null
  entries: BrowseEntry[]
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

/** dir はホームディレクトリからの相対パス。空文字でホーム直下を見る。 */
export async function browseDirectory(dir: string): Promise<BrowseResult> {
  const response = await fetch(`/api/browse?dir=${encodeURIComponent(dir)}`)
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<BrowseResult>
}

/** path はホームディレクトリからの相対パス。.json ファイルのみ読める。 */
export async function readBrowsedFile(path: string): Promise<string> {
  const response = await fetch(`/api/browse/file?path=${encodeURIComponent(path)}`)
  if (!response.ok) throw new Error(await readError(response))
  return response.text()
}
