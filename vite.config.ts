import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { Buffer } from 'node:buffer'

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

const SYSTEM_PROMPT = `あなたはノード型計算アプリの計算ブロック設計者です。ユーザーの目的から必要十分な入力と、上から順に評価できる代入式を設計してください。
式で使える演算子は + - * / ^ % と比較、関数は MAX, MIN, IF, ROUND, ROUNDUP, ROUNDDOWN, CEILING, FLOOR, SQRT, ABS, MOD, PI です。
各式は calcs の name = expr として扱われ、exprには入力名とそれより上のcalcsのnameだけを「{変数名}」の記法で使えます。日本語や空白を含む変数名も使えます。
全入力・全計算行に単位が必須です。無次元は "1"。複数出力にしてよいですが、ユーザーが必要な結果だけ exposed=true にしてください。
単位は mm, mm^2, m/s, kg*m/s^2 の形式で、式の次元と厳密に一致させてください。説明文ではなく必ず propose_block ツールを呼んでください。`

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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    plugins: [react(), aiBlockDesigner(resolveAiConfig(env)), perfProbe()],
    // Tailscale 越しに他の端末から開けるよう、全インターフェースで待ち受ける。
    server: { port: 5180, host: true, allowedHosts: true },
  }
})
