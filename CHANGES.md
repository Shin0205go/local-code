# 改善点

## package.jsonの修正

1. `bin`セクションの参照先を再度修正
   - 修正前: `"./bin/ollama-code.js"`
   - 修正後: `"./dist/bin/ollama-code.js"`

2. スクリプトの依存関係を明示化
   - `presetup`, `premcp-chat`などのスクリプトを追加し、必要なビルドを事前に実行するように修正
   - `build`スクリプトを`prebuild`, `build`, `postbuild`に分割して処理を明確化

3. ビルドプロセスの整理
   - TypeScriptのコンパイルとバイナリファイルの処理を分離
   - `build:bin`スクリプトを追加して実行権限設定のみを担当

## bin/ollama-code.jsの修正

1. mcp-chatコマンドの追加
   - プログラムにmcp-chatコマンドを明示的に追加し、動作を保証

## メリット

1. **実行の安定性向上**
   - 依存関係が明確になり、何かを実行する前に必ず必要なビルドが行われるようになりました
   - 例: `npm run setup`を実行すると、自動的に`npm run build`が先に実行されるため失敗を防止

2. **コード管理の改善**
   - バイナリ参照先とビルド成果物の場所が一致し、混乱を防止
   - ビルドプロセスがより明確になり、メンテナンスしやすくなりました

3. **開発体験の向上**
   - 明示的な前処理（pre-scripts）と後処理（post-scripts）により、npm scriptsの挙動が予測しやすくなりました

## 追加の変更

1. `prestart` スクリプトを追加し、`npm run start` 実行時に自動でビルドが行われるようになりました
2. 依存関係に `@modelcontextprotocol/sdk` を追加しました
