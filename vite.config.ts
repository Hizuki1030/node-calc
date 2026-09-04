import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { Buffer } from 'node:buffer'
import { lstat, mkdir, readdir, readFile, rename as renameFile, rm, stat, writeFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { homedir } from 'node:os'
import { relative, resolve, sep } from 'node:path'
import { UNIT_QUANTITIES } from './src/units/catalog.ts'

/** propose_block ツールの入力スキーマ。Anthropic / OpenAI 互換の両方式で使い回す。 */
const BLOCK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'inputs', 'calcs'],
  properties: {
    title: { type: 'string' },
    note: { type: 'string' },
    inputs: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['name', 'unit'], properties: { name: { type: 'string' }, unit: { type: 'string' } } },
    },
    calcs: {
      type: 'array', minItems: 1,
      items: { type: 'object', additionalProperties: false, required: ['name', 'expr', 'unit', 'exposed'], properties: {
        name: { type: 'string' }, expr: { type: 'string' }, unit: { type: 'string' }, exposed: { type: 'boolean' },
      } },
    },
  },
} as const

/**
 * 単位カタログから「量ごとに使える記号」のテキストを作る。ハードコードで重複させず、
 * catalog.ts が更新されたらプロンプト側も自動で追随する。
 */
function unitVocabularyText(): string {
  return UNIT_QUANTITIES
    .map((q) => `- ${q.name}: ${q.notations.map((n) => n.symbol).join(' ')}`)
    .join('\n')
}

const SYSTEM_PROMPT = `あなたはノード型計算アプリの計算ブロック設計者です。ユーザーの目的から必要十分な入力と、上から順に評価できる代入式を設計してください。
式で使える演算子は + - * / ^ % と比較、関数は MAX, MIN, IF, ROUND, ROUNDUP, ROUNDDOWN, CEILING, FLOOR, SQRT, ABS, MOD, PI です。
各式は calcs の name = expr として扱われ、exprには入力名とそれより上のcalcsのnameだけを「{変数名}」の記法で使えます。日本語や空白を含む変数名も使えます。
全入力・全計算行に単位が必須です。複数出力にしてよいですが、ユーザーが必要な結果だけ exposed=true にしてください。

単位の記号は、必ず次の一覧にある表記だけを使い、* / ^ で組み合わせてください（例: kg*m/s^2, 円/枚）。
一覧にない記号（degF、ヶ月、pcs など、それらしく見えても存在しない単位）は絶対に書かないでください。
一覧の中にちょうど良い量が無い場合や、回数・倍率・比率など単位を持たない掛け目には "1" を使ってください
（"ヶ月分の倍率" のような依頼は、月数を単位 "1" の無次元入力として扱えば表現できます）。
${unitVocabularyText()}

+ と - は、両辺の単位が表す「量」が完全に一致していないとエラーになります（片方が数値の 0 のときだけ例外）。
そのため摂氏→華氏のように定数を加算する換算のような「原点をずらす変換」はこのエンジンでは表現できません。
{x}*1.8+32 のように、単位を持つ量に裸の定数を足す・引く式は、宣言単位を無次元にしても必ずエラーになるので絶対に書かないでください。
そうした依頼が来たら、代わりに次のどちらかにしてください。
1. 定数の加減算が要らない部分だけを計算する（例: 比例部分のみ、差分・比較のみ）
2. 入力をそのまま出力に渡す恒等式にして、note で「このエンジンでは原点をずらす換算を表現できません」と理由を説明する
いずれの場合も、実際に単位検査を通る式だけを calcs に入れてください。

説明文ではなく必ず propose_block ツールを呼んでください。`

interface AiConfig {
  /** 'anthropic' は Messages API（Claude 直結、または同形式で応答する LiteLLM の /v1/messages）。
   *  'openai' は Chat Completions 形式（LiteLLM プロキシ等、OpenAI 互換エンドポイント全般）。 */
  style: 'anthropic' | 'openai'
  apiKey: string
  model: string
  base: string
}

/** どの LLM ベンダーを呼ぶかは環境変数で決める。UI 側は「AI」としか呼ばず、Claude 固定ではない。 */
function resolveAiConfig(env: Record<string, string>): AiConfig {
  const style = (env.AI_API_STYLE?.trim().toLowerCase() === 'openai') ? 'openai' : 'anthropic'
  const apiKey = env.AI_API_KEY || env.ANTHROPIC_API_KEY || ''
  const model = env.AI_MODEL || env.ANTHROPIC_MODEL || 'claude-sonnet-4-5'
  const base = (env.AI_API_BASE || (style === 'anthropic' ? 'https://api.anthropic.com' : '')).replace(/\/$/, '')
  return { style, apiKey, model, base }
}

function userMessage(request: string, current: unknown): string {
  return `要望:\n${request}\n\n現在のブロック定義（必要なら訂正）:\n${JSON.stringify(current ?? null)}`
}

async function callAnthropic(config: AiConfig, request: string, current: unknown): Promise<unknown> {
  const response = await fetch(`${config.base}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 2400,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage(request, current) }],
      tools: [{ name: 'propose_block', description: '検証可能な計算ブロック定義を提案する', input_schema: BLOCK_SCHEMA }],
      tool_choice: { type: 'tool', name: 'propose_block' },
    }),
  })
  const answer = await response.json() as { content?: Array<{ type: string; name?: string; input?: unknown }>; error?: { message?: string } }
  if (!response.ok) throw new Error(answer.error?.message || `AI API error (${response.status})`)
  const call = answer.content?.find((item) => item.type === 'tool_use' && item.name === 'propose_block')
  if (!call?.input) throw new Error('AIがブロック定義を返しませんでした')
  return call.input
}

/** OpenAI 互換の Chat Completions 形式。LiteLLM プロキシなど、Claude 以外へも振り分けられる経路。 */
async function callOpenAiCompatible(config: AiConfig, request: string, current: unknown): Promise<unknown> {
  const response = await fetch(`${config.base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 2400,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage(request, current) },
      ],
      tools: [{ type: 'function', function: { name: 'propose_block', description: '検証可能な計算ブロック定義を提案する', parameters: BLOCK_SCHEMA } }],
      tool_choice: { type: 'function', function: { name: 'propose_block' } },
    }),
  })
  const answer = await response.json() as {
    choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>
    error?: { message?: string }
  }
  if (!response.ok) throw new Error(answer.error?.message || `AI API error (${response.status})`)
  const call = answer.choices?.[0]?.message?.tool_calls?.find((item) => item.function?.name === 'propose_block')
  if (!call?.function?.arguments) throw new Error('AIがブロック定義を返しませんでした')
  try {
    return JSON.parse(call.function.arguments)
  } catch {
    throw new Error('AIの応答をJSONとして読めませんでした')
  }
}

/**
 * 計算ブロックの設計を AI に頼む窓口。呼び先は Claude 直結でも、LiteLLM 経由で他ベンダーへ
 * 振り分けてもよい（AI_API_STYLE=openai）。APIキーはブラウザへ渡さず、Vite のサーバー側で保持する。
 */
function aiBlockDesigner(config: AiConfig): Plugin {
  return {
    name: 'node-calc-ai-block-designer',
    configureServer(server) {
      server.middlewares.use('/api/ai/block', async (req, res) => {
        res.setHeader('content-type', 'application/json; charset=utf-8')
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'POSTのみ利用できます' }))
          return
        }
        if (!config.apiKey) {
          res.statusCode = 503
          res.end(JSON.stringify({ error: 'AI_API_KEY（または ANTHROPIC_API_KEY）が設定されていません。開発サーバーの .env に設定して再起動してください。' }))
          return
        }
        if (config.style === 'openai' && !config.base) {
          res.statusCode = 503
          res.end(JSON.stringify({ error: 'AI_API_STYLE=openai を使う場合は AI_API_BASE（LiteLLM プロキシ等のURL）も設定してください。' }))
          return
        }
        try {
          const chunks: Uint8Array[] = []
          for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { request?: string; current?: unknown }
          if (!body.request?.trim()) throw new Error('計算したい内容を書いてください')

          const draft = config.style === 'openai'
            ? await callOpenAiCompatible(config, body.request, body.current)
            : await callAnthropic(config, body.request, body.current)
          res.end(JSON.stringify({ draft }))
        } catch (error) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      })
    },
  }
}

/** 日本語入力の重さを実測するための一時的な計測。原因が分かったら消す。 */
function perfProbe(): Plugin {
  return {
    name: 'node-calc-perf-probe',
    apply: 'serve',
    transformIndexHtml(_html, ctx) {
      // 計測そのものが入力を重くしていないかを確かめたいので、比較用のページには入れない。
      if (ctx.path.startsWith('/dev/')) return []
      return [{ tag: 'script', attrs: { type: 'module', src: '/dev/perf-probe.ts' }, injectTo: 'head' as const }]
    },
    configureServer(server) {
      server.middlewares.use('/api/perf', async (req, res) => {
        const chunks: Uint8Array[] = []
        for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
        // プロジェクト内に書くと Vite のファイル監視を無駄に叩くので、外へ出す。
        const { appendFile } = await import('node:fs/promises')
        await appendFile('/tmp/node-calc-perf.jsonl', `${Buffer.concat(chunks).toString('utf8')}\n`)
        res.statusCode = 204
        res.end()
      })
    },
  }
}

/** リクエスト本体を文字列として読み切る。 */
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = []
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * プロジェクトファイル（グラフ JSON）をサーバー側のフォルダで管理する API。
 * 自作ファイルエクスプローラーから使う。Tailscale 越しの iPad など、どの端末から
 * 開いても同じ一覧・内容を参照できるようにするためのもの。
 */
function projectFiles(dir: string): Plugin {
  /** パス区切りやドット始まりの名前を拒否し、フォルダの外へ出られないようにする。 */
  const safeName = (raw: unknown): string | null => {
    const name = String(raw ?? '').trim()
    if (!name || name.length > 128 || name === '.' || name === '..' || name.startsWith('.')) return null
    if (/[\\/]/.test(name)) return null
    return name
  }
  return {
    name: 'node-calc-project-files',
    async configureServer(server) {
      await mkdir(dir, { recursive: true })
      server.middlewares.use('/api/files', async (req, res) => {
        res.setHeader('content-type', 'application/json; charset=utf-8')
        const fail = (status: number, message: string) => {
          res.statusCode = status
          res.end(JSON.stringify({ error: message }))
        }
        try {
          // connect はマウント位置 /api/files を外して req.url を渡してくる。
          // 念のため、残っていても動くようプレフィックスはあれば取り除く。
          let pathname = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/')
          if (pathname.startsWith('/api/files')) pathname = pathname.slice('/api/files'.length)
          const rest = pathname.replace(/^\//, '')
          const segments = rest ? rest.split('/') : []

          // 一覧
          if (req.method === 'GET' && !rest) {
            const entries = await readdir(dir, { withFileTypes: true })
            const files: Array<{ name: string; size: number; modified: number }> = []
            for (const entry of entries) {
              if (!entry.isFile() || entry.name.startsWith('.')) continue
              const info = await stat(resolve(dir, entry.name))
              files.push({ name: entry.name, size: info.size, modified: info.mtimeMs })
            }
            files.sort((a, b) => a.name.localeCompare(b.name, 'ja'))
            res.end(JSON.stringify({ files }))
            return
          }

          // 名前変更
          if (segments.length === 2 && segments[1] === 'rename') {
            if (req.method !== 'POST') return fail(405, 'POSTのみ利用できます')
            const name = safeName(segments[0])
            if (!name) return fail(400, 'ファイル名が不正です')
            const body = JSON.parse(await readBody(req)) as { to?: unknown }
            const to = safeName(body?.to)
            if (!to) return fail(400, '新しいファイル名が不正です')
            if (to !== name) await renameFile(resolve(dir, name), resolve(dir, to))
            res.end(JSON.stringify({ ok: true }))
            return
          }

          // 単一ファイルの読込・保存・削除
          if (segments.length !== 1 || !segments[0]) return fail(404, 'ファイルが見つかりません')
          const name = safeName(segments[0])
          if (!name) return fail(400, 'ファイル名が不正です')
          const filePath = resolve(dir, name)

          if (req.method === 'GET') {
            const content = await readFile(filePath, 'utf8')
            res.setHeader('content-type', 'text/plain; charset=utf-8')
            res.end(content)
            return
          }
          if (req.method === 'PUT') {
            // 途中で切れた書き込みが残らないよう、一時ファイルへ書いてから置き換える。
            const temp = resolve(dir, `.${name}.tmp-${process.pid}-${Date.now()}`)
            await writeFile(temp, await readBody(req), 'utf8')
            await renameFile(temp, filePath)
            res.end(JSON.stringify({ ok: true }))
            return
          }
          if (req.method === 'DELETE') {
            await rm(filePath)
            res.end(JSON.stringify({ ok: true }))
            return
          }
          fail(405, 'GET・PUT・DELETEのみ利用できます')
        } catch (error) {
          if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
            return fail(404, 'ファイルが見つかりません')
          }
          fail(400, error instanceof Error ? error.message : String(error))
        }
      })
    },
  }
}

/**
 * ホームディレクトリ配下を自作ファイルエクスプローラーで辿るための読み取り専用 API。
 * 「プロジェクトを開く」画面から、projects フォルダの外にある .json も見つけられるようにする。
 * サーバー側がファイルシステムへ触れる窓口なので、ホームディレクトリの外へは
 * 絶対に出られないよう、どのパスも resolve 後に relative でホーム配下かを確かめる。
 */
function fileBrowser(): Plugin {
  const home = homedir()

  /** ホームからの相対パス（空文字はホーム自身）を安全な絶対パスへ直す。範囲外なら null。 */
  const resolveInHome = (rawRelative: unknown): string | null => {
    const requested = typeof rawRelative === 'string' ? rawRelative : ''
    const target = resolve(home, requested || '.')
    const rel = relative(home, target)
    if (rel === '') return target // ホーム自身
    if (rel.startsWith('..') || rel.startsWith(`.${sep}..`)) return null
    // resolve は絶対パスを渡されるとそのまま返すので、二重チェックで弾く。
    if (resolve(rel) === rel) return null
    return target
  }

  return {
    name: 'node-calc-file-browser',
    configureServer(server) {
      server.middlewares.use('/api/browse', async (req, res) => {
        res.setHeader('content-type', 'application/json; charset=utf-8')
        const fail = (status: number, message: string) => {
          res.statusCode = status
          res.end(JSON.stringify({ error: message }))
        }
        try {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const pathname = url.pathname

          // ファイル読み込み: /api/browse/file?path=<ホームからの相対パス>
          if (pathname === '/file' || pathname === '/' || pathname === '') {
            const isFile = pathname === '/file'
            if (req.method !== 'GET') return fail(405, 'GETのみ利用できます')
            if (isFile) {
              const requested = url.searchParams.get('path')
              const target = resolveInHome(requested)
              if (!target) return fail(400, 'ホームディレクトリの外は開けません')
              if (!target.toLowerCase().endsWith('.json')) return fail(400, '.jsonファイルのみ開けます')
              const info = await stat(target)
              if (!info.isFile()) return fail(400, 'ファイルではありません')
              const content = await readFile(target, 'utf8')
              res.setHeader('content-type', 'text/plain; charset=utf-8')
              res.end(content)
              return
            }

            // 一覧: /api/browse?dir=<ホームからの相対パス>
            const requestedDir = url.searchParams.get('dir')
            const target = resolveInHome(requestedDir)
            if (!target) return fail(400, 'ホームディレクトリの外は見られません')
            const entries = await readdir(target, { withFileTypes: true })
            const listed: Array<{ name: string; type: 'dir' | 'file'; size: number; modified: number }> = []
            for (const entry of entries) {
              if (entry.name.startsWith('.')) continue
              const entryPath = resolve(target, entry.name)
              // シンボリックリンクは辿らない。ホーム外への抜け道にしない。
              const linkInfo = await lstat(entryPath)
              if (linkInfo.isSymbolicLink()) continue
              if (entry.isDirectory()) {
                listed.push({ name: entry.name, type: 'dir', size: 0, modified: linkInfo.mtimeMs })
              } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
                listed.push({ name: entry.name, type: 'file', size: linkInfo.size, modified: linkInfo.mtimeMs })
              }
            }
            listed.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'ja') : a.type === 'dir' ? -1 : 1))
            const dir = relative(home, target)
            const parent = target === home ? null : relative(home, resolve(target, '..'))
            res.end(JSON.stringify({ home, dir, parent, entries: listed }))
            return
          }
          fail(404, '見つかりません')
        } catch (error) {
          if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
            return fail(404, 'フォルダまたはファイルが見つかりません')
          }
          fail(400, error instanceof Error ? error.message : String(error))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    plugins: [
      react(),
      aiBlockDesigner(resolveAiConfig(env)),
      perfProbe(),
      projectFiles(resolve(env.PROJECTS_DIR || 'projects')),
      fileBrowser(),
    ],
    // Tailscale 越しに他の端末から開けるよう、全インターフェースで待ち受ける。
    server: { port: 5180, host: true, allowedHosts: true },
  }
})
