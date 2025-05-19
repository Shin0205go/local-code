# Ollama Code

Ollamaモデルを活用したAIコーディングアシスタント。ローカルLLMとMCP（Model Context Protocol）ツールを統合し、自然な対話形式でプログラミングを支援します。

## 特徴

- **ローカルモデル**: OllamaのLLMを使用、プライバシーと高速レスポンスを実現
- **自然な対話**: 人間のように話しかけるだけで操作可能
- **シンプルなインターフェース**: 複雑なコマンドを必要とせず、自然言語で指示
- **MCP対応**: ファイルシステム、GitHub、検索などの外部ツールにアクセス
- **Dockerサンドボックス**: 生成されたコードを安全に実行

## インストール

```bash
git clone https://github.com/yourusername/ollama-code.git
cd ollama-code
npm install
npm run build
# MCP機能を利用するためのSDKはバージョンを固定しています
# (package.jsonで@modelcontextprotocol/sdk@1.11.4)
npm link
```

## 使用方法

最初のセットアップ（初回のみ必要）:

```bash
ollama-code setup
```

`npm start` を実行すると自動的にビルドが行われ、`dist` ディレクトリから CLI
が起動します。

### 基本的な使い方

```bash
# 対話モードを開始
ollama-code

# 単発のタスク実行
ollama-code "現在のディレクトリにあるファイル一覧を表示して"
ollama-code "フィボナッチ数列を計算するJavaScriptコードを書いて"
ollama-code "このプロジェクトのコードをリファクタリングする方法を教えて"
```

### 上級者向けコマンド

```bash
# コードベースの詳細分析
ollama-code analyze ./src
```

## MCPの使用

Ollama Codeは自動的にMCPサーバーを検出して使用します。セットアップ時にMCPサーバーを有効にすると、以下のような質問に回答できるようになります：

- ファイル操作: "このプロジェクトにあるJavaScriptファイルをすべて一覧表示して"
- コード分析: "このリポジトリから重複コードを見つけて"
- 情報検索: "最新のNode.jsセキュリティ対策について教えて"

## MCPサーバーのインストール

以下のコマンドで一般的なMCPサーバーをインストールできます：

```bash
# ファイルシステムMCPサーバー
npm install -g @modelcontextprotocol/server-filesystem

# GitHubサーバー
npm install -g @modelcontextprotocol/server-github

# Brave検索サーバー
npm install -g @modelcontextprotocol/server-brave-search
```

## 要件

- Node.js 18以上
- Ollama（ローカルで実行）
- Docker（サンドボックス実行用、オプション）
- MCPサーバー（オプション）

## ライセンス

MIT
