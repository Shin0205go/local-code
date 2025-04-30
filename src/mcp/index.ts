/**
 * Model Context Protocol (MCP) インテグレーションのメインエントリーポイント
 * MCPのコンポーネント、クライアント、サーバー、ツールをエクスポート
 */

// クライアントをエクスポート
export * from './client.js';

// 設定をエクスポート
export * from './config.js';

// サーバーマネージャーをエクスポート（明示的な名前でエクスポートして競合を防ぐ）
export { MCPServerManager } from './server.js';

// Ollamaブリッジをエクスポート
export * from './ollama-bridge.js';

// 追加コンポーネントは必要に応じて追加
