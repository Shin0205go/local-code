# Ollama Code

Ollamaモデルを活用したコーディング支援CLIツール。主な機能は以下の通り：

- ローカルOllamaモデルとの統合
- Dockerコンテナによるサンドボックス実行環境
- GitHubリポジトリの分析（実験的）
- MCP（Model Context Protocol）との連携

## インストール

```bash
git clone https://github.com/yourusername/ollama-code.git
cd ollama-code
npm install
npm link
```

## 使用方法

```bash
# セットアップ
ollama-code setup

# ディレクトリ内のコード解析
ollama-code analyze ./src

# コーディングタスクの実行
ollama-code execute "フィボナッチ数列を計算する関数を作成"

# サンドボックス実行
ollama-code --sandbox execute "メールアドレスを検証する関数を書いてテスト"

# GitHubリポジトリと連携
ollama-code --github https://github.com/user/repo execute "このリポジトリにテストを追加"
```

## 要件

- Node.js 18以上
- Ollama（ローカルで実行）
- Docker（サンドボックス実行用、オプション）

## ライセンス

MIT
