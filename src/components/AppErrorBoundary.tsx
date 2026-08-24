import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

/** 1ノードの不正データでアプリ全体が黒画面になるのを防ぐ最後の保護。 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('node-calc の描画を復旧できませんでした', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <main className="nc-fatal-error" role="alert">
      <section>
        <h1>プロジェクトを表示できませんでした</h1>
        <p>保存データを読み直すと復旧できる場合があります。作業内容は削除していません。</p>
        <code>{this.state.error.message}</code>
        <button className="nc-btn nc-btn-primary" onClick={() => location.reload()}>再読み込み</button>
      </section>
    </main>
  }
}
