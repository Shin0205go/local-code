/**
 * Model Context Protocol (MCP) インテグレーションのメインエントリーポイント
 * MCPのコンポーネント、クライアント、サーバー、ツールをエクスポート
 */

// クライアントをエクスポート
export * from './client';

// 設定をエクスポート
export * from './config';

// サーバーマネージャーをエクスポート（明示的な名前でエクスポートして競合を防ぐ）
export { MCPServerManager } from './server';

// Ollamaブリッジをエクスポート
export * from './ollama-bridge';

// GitHubインテグレーションをエクスポート
export * from './github';

// 追加コンポーネントは必要に応じて追加
