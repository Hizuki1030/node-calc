import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { Buffer } from 'node:buffer'

function claudeBlockDesigner(apiKey: string, model: string): Plugin {
  return {
    name: 'node-calc-claude-block-designer',
    configureServer(server) {
      server.middlewares.use('/api/ai/block', async (req, res) => {
        res.setHeader('content-type', 'application/json; charset=utf-8')
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'POSTのみ利用できます' }))
          return
        }
        if (!apiKey) {
          res.statusCode = 503
          res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY が設定されていません。開発サーバーの .env に設定して再起動してください。' }))
          return
        }
        try {
          const chunks: Uint8Array[] = []
          for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { request?: string; current?: unknown }
          if (!body.request?.trim()) throw new Error('計算したい内容を書いてください')

          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model,
              max_tokens: 2400,
              system: `あなたはノード型計算アプリの計算ブロック設計者です。ユーザーの目的から必要十分な入力と、上から順に評価できる代入式を設計してください。
式で使える演算子は + - * / ^ % と比較、関数は MAX, MIN, IF, ROUND, ROUNDUP, ROUNDDOWN, CEILING, FLOOR, SQRT, ABS, MOD, PI です。
各式は calcs の name = expr として扱われ、exprには入力名とそれより上のcalcsのnameだけを「{変数名}」の記法で使えます。日本語や空白を含む変数名も使えます。
全入力・全計算行に単位が必須です。無次元は "1"。複数出力にしてよいですが、ユーザーが必要な結果だけ exposed=true にしてください。
単位は mm, mm^2, m/s, kg*m/s^2 の形式で、式の次元と厳密に一致させてください。説明文ではなく必ず propose_block ツールを呼んでください。`,
              messages: [{ role: 'user', content: `要望:\n${body.request}\n\n現在のブロック定義（必要なら訂正）:\n${JSON.stringify(body.current ?? null)}` }],
              tools: [{
                name: 'propose_block',
                description: '検証可能な計算ブロック定義を提案する',
                input_schema: {
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
                },
              }],
              tool_choice: { type: 'tool', name: 'propose_block' },
            }),
          })
          const answer = await response.json() as { content?: Array<{ type: string; name?: string; input?: unknown }>; error?: { message?: string } }
          if (!response.ok) throw new Error(answer.error?.message || `Claude API error (${response.status})`)
          const call = answer.content?.find((item) => item.type === 'tool_use' && item.name === 'propose_block')
          if (!call?.input) throw new Error('Claudeがブロック定義を返しませんでした')
          res.end(JSON.stringify({ draft: call.input }))
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
    plugins: [react(), claudeBlockDesigner(env.ANTHROPIC_API_KEY ?? '', env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5'), perfProbe()],
    // Tailscale 越しに他の端末から開けるよう、全インターフェースで待ち受ける。
    server: { port: 5180, host: true, allowedHosts: true },
  }
})
