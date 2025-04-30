/**
 * Ollama-MCPブリッジ
 * OllamaとModel Context Protocolの連携を行うブリッジ実装
 */

import { MCPClient, MCPTool } from './client.js';
import { ServerConfigManager, ServerConfig } from './config.js';
import { MCPServerManager } from './server.js';
import path from 'path';

/**
 * Ollamaツールの型定義（Ollamaのツール形式）
 */
export interface OllamaTool {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

/**
 * MCPツールをOllamaツール形式に変換したレスポンス
 */
export interface MCPOllamaToolsResponse {
  tools: OllamaTool[];
  servers: string[];
}

/**
 * MCPツール呼び出しのパラメータ
 */
export interface MCPToolCallParams {
  serverId: string;
  toolName: string;
  arguments: Record<string, any>;
}

/**
 * MCPツール呼び出しのレスポンス
 */
export interface MCPToolCallResponse {
  result: string;
  isError: boolean;
}

export class OllamaMCPBridge {
  private serverManager: MCPServerManager;
  private clients: Map<string, MCPClient> = new Map();
  private serverBaseUrls: Map<string, string> = new Map();
  private toolCache: Map<string, MCPTool[]> = new Map();
  private configPath: string;

  /**
   * Ollama-MCPブリッジを初期化
   * @param configPath 設定ファイルパス（省略時はデフォルト）
   */
  constructor(configPath?: string) {
    this.configPath = configPath || path.join(process.cwd(), 'config/mcp-config.json');
    this.serverManager = new MCPServerManager();
  }

  /**
   * ブリッジを初期化して利用可能なMCPサーバーを起動
   */
  async initialize(): Promise<string[]> {
    try {
      // MCPサーバーを初期化・起動
      const serverConfigs = await this.serverManager.loadServerConfigs();
      console.log(`${serverConfigs.length}個のMCPサーバー設定をロードしました`);

      const startedServers: string[] = [];
      for (const config of serverConfigs) {
        try {
          await this.serverManager.startServer(config);
          console.log(`MCPサーバー ${config.id} を起動しました`);
          startedServers.push(config.id);
          
          // MCPクライアントを作成してキャッシュ
          await this.createClient(config);
        } catch (error) {
          console.error(`MCPサーバー ${config.id} の起動に失敗:`, error instanceof Error ? error.message : String(error));
        }
      }

      return startedServers;
    } catch (error) {
      console.error('MCPブリッジの初期化に失敗:', error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  /**
   * 指定したMCPサーバーのクライアントを作成
   * @param config サーバー設定
   */
  private async createClient(config: ServerConfig): Promise<void> {
    try {
      // サーバーがSSE/HTTP形式の場合の処理
      // ここではモック実装としてHTTPエンドポイントを決め打ちで設定
      // 実際には設定ファイルからSSEエンドポイントを取得する必要がある
      const serverUrl = `http://localhost:3000/api/mcp/${config.id}`;
      this.serverBaseUrls.set(config.id, serverUrl);
      
      const client = new MCPClient({
        serverUrl: serverUrl
      });
      
      this.clients.set(config.id, client);
      
      // ツールリストをプリロード
      await this.cacheToolList(config.id);
    } catch (error) {
      console.error(`MCPクライアント作成エラー (${config.id}):`, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * MCPサーバーのツールリストをキャッシュ
   * @param serverId サーバーID
   */
  private async cacheToolList(serverId: string): Promise<void> {
    try {
      const client = this.clients.get(serverId);
      if (!client) {
        throw new Error(`MCPクライアントが見つかりません: ${serverId}`);
      }
      
      const tools = await client.listTools();
      console.log(`MCPサーバー ${serverId} から${tools.length}個のツールを取得しました`);
      this.toolCache.set(serverId, tools);
    } catch (error) {
      console.error(`ツールリストのキャッシュに失敗 (${serverId}):`, error instanceof Error ? error.message : String(error));
      // キャッシュ失敗時は空のリストをセット
      this.toolCache.set(serverId, []);
    }
  }

  /**
   * すべてのMCPサーバーから利用可能なツールをOllama形式で取得
   * @returns Ollama形式のツールと提供サーバーリスト
   */
  async getOllamaTools(): Promise<MCPOllamaToolsResponse> {
    try {
      const runningServers = this.serverManager.getRunningServers();
      if (runningServers.length === 0) {
        console.warn('実行中のMCPサーバーがありません');
        return { tools: [], servers: [] };
      }
      
      const ollamaTools: OllamaTool[] = [];
      const serverIds: string[] = [];
      
      // 各サーバーからツールリストを取得し、Ollama形式に変換
      for (const serverId of runningServers) {
        try {
          // キャッシュからツールリストを取得、なければ再取得
          let tools = this.toolCache.get(serverId) || [];
          if (tools.length === 0) {
            const client = this.clients.get(serverId);
            if (client) {
              tools = await client.listTools();
              this.toolCache.set(serverId, tools);
            }
          }
          
          if (tools.length > 0) {
            // ツールをOllama形式に変換
            const convertedTools = tools.map(tool => this.convertToOllamaTool(tool, serverId));
            ollamaTools.push(...convertedTools);
            serverIds.push(serverId);
          }
        } catch (error) {
          console.error(`サーバー ${serverId} からのツール取得エラー:`, error instanceof Error ? error.message : String(error));
        }
      }
      
      return { tools: ollamaTools, servers: serverIds };
    } catch (error) {
      console.error('Ollamaツール変換エラー:', error instanceof Error ? error.message : String(error));
      return { tools: [], servers: [] };
    }
  }

  /**
   * MCPツールをOllama形式に変換
   * @param tool MCPツール
   * @param serverId サーバーID（プレフィックスとして使用）
   * @returns Ollama形式のツール
   */
  private convertToOllamaTool(tool: MCPTool, serverId: string): OllamaTool {
    // サーバーIDとツール名を組み合わせてユニークな名前を作成
    // 例: "github__get_repo_info"
    const toolName = `${serverId}__${tool.name}`;
    
    return {
      type: 'function',
      function: {
        name: toolName,
        description: `[${serverId}] ${tool.description}`,
        parameters: tool.parameters
      }
    };
  }

  /**
   * ツール名からサーバーIDとオリジナルのツール名を抽出
   * @param combinedToolName 結合されたツール名（例: "github__get_repo_info"）
   * @returns サーバーIDとツール名のペア
   */
  private extractServerAndToolName(combinedToolName: string): { serverId: string; toolName: string } {
    const parts = combinedToolName.split('__');
    if (parts.length !== 2) {
      throw new Error(`不正なツール名形式: ${combinedToolName}`);
    }
    
    return {
      serverId: parts[0],
      toolName: parts[1]
    };
  }

  /**
   * Ollamaのツール呼び出しをMCPサーバーに転送
   * @param toolName ツール名（サーバーID__ツール名）
   * @param args ツールの引数
   * @returns ツール実行結果
   */
  async callOllamaTool(toolName: string, args: Record<string, any>): Promise<MCPToolCallResponse> {
    try {
      // ツール名からサーバーIDとツール名を抽出
      const { serverId, toolName: originalToolName } = this.extractServerAndToolName(toolName);
      
      // サーバーが実行中かチェック
      if (!this.serverManager.isServerRunning(serverId)) {
        throw new Error(`MCPサーバー "${serverId}" は実行されていません`);
      }
      
      // クライアントを取得
      const client = this.clients.get(serverId);
      if (!client) {
        throw new Error(`MCPクライアント "${serverId}" が見つかりません`);
      }
      
      console.log(`MCPツール呼び出し: ${serverId}.${originalToolName}(${JSON.stringify(args)})`);
      
      // ツールを呼び出し
      const result = await client.callTool(originalToolName, args);
      
      // 結果を加工して返す
      let response = '';
      if (result.content) {
        for (const content of result.content) {
          if (content.type === 'text' && content.text) {
            response += content.text;
          } else if (content.type === 'resource' && content.resource) {
            if (content.resource.text) {
              response += content.resource.text;
            } else {
              response += `[Resource: ${content.resource.uri} (${content.resource.mimeType})]`;
            }
          }
        }
      }
      
      return {
        result: response,
        isError: result.isError
      };
    } catch (error) {
      console.error('Ollamaツール呼び出しエラー:', error instanceof Error ? error.message : String(error));
      return {
        result: `ツール呼び出しエラー: ${error instanceof Error ? error.message : String(error)}`,
        isError: true
      };
    }
  }

  /**
   * ブリッジをシャットダウン
   */
  async shutdown(): Promise<void> {
    try {
      // すべてのMCPサーバーを停止
      await this.serverManager.stopAllServers();
      console.log('すべてのMCPサーバーを停止しました');
      
      // クライアントをクリア
      this.clients.clear();
      this.toolCache.clear();
    } catch (error) {
      console.error('MCPブリッジのシャットダウンエラー:', error instanceof Error ? error.message : String(error));
    }
  }
}
