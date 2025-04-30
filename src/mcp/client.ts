/**
 * MCPクライアント - Model Context Protocolでツールをリスト・呼び出しするためのクライアント
 */

import type { Response } from 'node-fetch';

const fetchModule = () => import('node-fetch').then(({default: fetch}) => fetch);

/**
 * ツール定義の型
 */
export interface MCPTool {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * JSON-RPCレスポンスの型
 */
interface JsonRpcResponse {
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
  id: number;
  jsonrpc: string;
}

/**
 * ツールリストレスポンスの型
 */
interface MCPToolsListResponse {
  tools: MCPTool[];
  listChanged: boolean;
}

/**
 * ツール呼び出しのレスポンス
 */
export interface MCPToolResult {
  content: {
    type: string;
    text?: string;
    resource?: {
      uri: string;
      mimeType: string;
      text?: string;
    };
  }[];
  isError: boolean;
}

/**
 * MCPクライアント設定
 */
export interface MCPClientConfig {
  serverUrl: string;
  timeout?: number;
  serverId?: string; // サーバーID（ログや区別のため）
}

/**
 * MCPクライアント
 */
export class MCPClient {
  private serverUrl: string;
  private timeout: number;
  private jsonRpcId: number = 1;
  private serverId?: string;
  private toolCache?: MCPTool[]; // ツールキャッシュ
  
  /**
   * MCPクライアントを初期化
   * @param config クライアント設定
   */
  constructor(config: MCPClientConfig) {
    this.serverUrl = config.serverUrl;
    this.timeout = config.timeout || 30000; // デフォルトタイムアウト: 30秒
    this.serverId = config.serverId;
  }

  /**
   * 利用可能なツールのリストを取得
   * @param useCache キャッシュを使用するか
   * @returns ツールのリスト
   */
  async listTools(useCache: boolean = true): Promise<MCPTool[]> {
    try {
      // キャッシュがあれば利用
      if (useCache && this.toolCache) {
        return this.toolCache;
      }
      
      const fetch = await fetchModule();
      
      const requestId = this.getNextId();
      const response = await this.sendJsonRpcRequest(
        'tools/list',
        {},
        requestId
      );

      // 型アサーションを使用して安全にアクセス
      const responseData = await response.json() as JsonRpcResponse;
      const result = responseData.result;
      
      if (!result || !result.tools) {
        console.warn(`MCPサーバー${this.serverId ? ` ${this.serverId}` : ''}からツールリストを取得できませんでした`);
        return [];
      }

      // キャッシュに保存
      this.toolCache = result.tools;
      
      return result.tools;
    } catch (error) {
      console.error(`MCPツールリスト取得エラー${this.serverId ? ` (${this.serverId})` : ''}:`, error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  /**
   * ツールをサポートしているか確認
   * @param toolName ツール名
   * @returns サポートしているか
   */
  async supportsTool(toolName: string): Promise<boolean> {
    const tools = await this.listTools();
    return tools.some(tool => tool.name === toolName);
  }

  /**
   * ツールを呼び出す
   * @param toolName ツール名
   * @param args ツール引数
   * @returns ツール実行結果
   */
  async callTool(toolName: string, args: Record<string, any>): Promise<MCPToolResult> {
    try {
      // ツールがサポートされているか確認
      const isSupported = await this.supportsTool(toolName);
      if (!isSupported) {
        throw new Error(`ツール '${toolName}' はサーバー${this.serverId ? ` ${this.serverId}` : ''}でサポートされていません`);
      }
      
      const requestId = this.getNextId();
      const response = await this.sendJsonRpcRequest(
        'tools/call',
        {
          name: toolName,
          arguments: args
        },
        requestId
      );

      // 型アサーションを使用して安全にアクセス
      const responseData = await response.json() as JsonRpcResponse;
      const result = responseData.result;
      const error = responseData.error;
      
      if (error) {
        console.error(`MCPツール呼び出しエラー${this.serverId ? ` (${this.serverId})` : ''}:`, error);
        return {
          content: [{
            type: 'text',
            text: `ツール呼び出しエラー: ${error.message || JSON.stringify(error)}`
          }],
          isError: true
        };
      }

      return result;
    } catch (error) {
      console.error(`MCPツール呼び出しエラー${this.serverId ? ` (${this.serverId})` : ''}:`, error instanceof Error ? error.message : String(error));
      return {
        content: [{
          type: 'text',
          text: `ツール呼び出しエラー: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  }

  /**
   * JSON-RPC形式のリクエストを送信
   * @param method メソッド名
   * @param params パラメータ
   * @param id リクエストID
   * @returns レスポンス
   */
  private async sendJsonRpcRequest(
    method: string,
    params: Record<string, any>,
    id: number
  ): Promise<Response> {
    const fetch = await fetchModule();
    
    const payload = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    // この部分はnode-fetchの型とRequestInitの型の不一致を修正
    // 1. stringに変換されたJSONを使用
    const bodyContent = JSON.stringify(payload);
    
    // 2. RequestInitのオプションを適切に設定
    const requestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: bodyContent
      // timeoutプロパティは削除（RequestInit型に存在しない）
    };

    const response = await fetch(this.serverUrl, requestOptions);

    if (!response.ok) {
      throw new Error(`MCPサーバーからのレスポンスエラー: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  /**
   * 次のリクエストIDを取得
   */
  private getNextId(): number {
    return this.jsonRpcId++;
  }
  
  /**
   * サーバーIDを取得
   */
  getServerId(): string | undefined {
    return this.serverId;
  }
  
  /**
   * サーバーURLを取得
   */
  getServerUrl(): string {
    return this.serverUrl;
  }
}

/**
 * 複数のMCPサーバー間でのルーティングを管理するクライアント
 */
export class MCPMultiClient {
  private clients: Map<string, MCPClient> = new Map();
  private toolServerMap: Map<string, string[]> = new Map(); // ツール名 => サーバーIDのリスト
  private initialized = false;
  
  /**
   * クライアントを追加
   * @param serverId サーバーID
   * @param client クライアント
   */
  addClient(serverId: string, client: MCPClient): void {
    this.clients.set(serverId, client);
  }
  
  /**
   * 初期化
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    // 各クライアントの利用可能なツールを取得
    for (const [serverId, client] of this.clients.entries()) {
      try {
        const tools = await client.listTools();
        
        // ツールとサーバーのマッピングを作成
        for (const tool of tools) {
          if (!this.toolServerMap.has(tool.name)) {
            this.toolServerMap.set(tool.name, []);
          }
          this.toolServerMap.get(tool.name)?.push(serverId);
        }
        
        console.log(`サーバー ${serverId} で${tools.length}個のツールを検出しました`);
      } catch (error) {
        console.error(`サーバー ${serverId} のツール取得エラー:`, error instanceof Error ? error.message : String(error));
      }
    }
    
    this.initialized = true;
    
    // 各ツールを持つサーバーを表示
    for (const [toolName, serverIds] of this.toolServerMap.entries()) {
      console.log(`ツール ${toolName} をサポートするサーバー: ${serverIds.join(', ')}`);
    }
  }
  
  /**
   * 指定したツールをサポートするサーバーIDのリストを取得
   * @param toolName ツール名
   * @returns サーバーIDのリスト
   */
  getServerIdsForTool(toolName: string): string[] {
    // まだ初期化されていない場合はエラー
    if (!this.initialized) {
      throw new Error('MCPMultiClientが初期化されていません。initialize()を呼び出してください。');
    }
    
    return this.toolServerMap.get(toolName) || [];
  }
  
  /**
   * ツールを呼び出す
   * @param toolName ツール名
   * @param args ツール引数
   * @returns ツール実行結果
   */
  async callTool(toolName: string, args: Record<string, any>): Promise<MCPToolResult> {
    // まだ初期化されていない場合は初期化
    if (!this.initialized) {
      await this.initialize();
    }
    
    // ツールをサポートするサーバーを取得
    const serverIds = this.getServerIdsForTool(toolName);
    
    if (serverIds.length === 0) {
      return {
        content: [{
          type: 'text',
          text: `エラー: ツール '${toolName}' をサポートするサーバーが見つかりません`
        }],
        isError: true
      };
    }
    
    // 最初のサーバーを試す
    let lastError = null;
    
    for (const serverId of serverIds) {
      const client = this.clients.get(serverId);
      
      if (!client) {
        console.warn(`サーバー ${serverId} のクライアントが見つかりません`);
        continue;
      }
      
      try {
        console.log(`サーバー ${serverId} でツール ${toolName} を実行中...`);
        return await client.callTool(toolName, args);
      } catch (error) {
        console.error(`サーバー ${serverId} でのツール ${toolName} 実行エラー:`, error instanceof Error ? error.message : String(error));
        lastError = error;
        // エラーが発生した場合は次のサーバーを試す
      }
    }
    
    // すべてのサーバーが失敗した場合
    return {
      content: [{
        type: 'text',
        text: `エラー: すべてのサーバーでツール ${toolName} の実行に失敗しました: ${lastError instanceof Error ? lastError.message : String(lastError)}`
      }],
      isError: true
    };
  }
  
  /**
   * すべてのサーバーからツールリストを取得
   * @returns サーバーID => ツールリストのマップ
   */
  async getAllTools(): Promise<Record<string, MCPTool[]>> {
    // まだ初期化されていない場合は初期化
    if (!this.initialized) {
      await this.initialize();
    }
    
    const result: Record<string, MCPTool[]> = {};
    
    for (const [serverId, client] of this.clients.entries()) {
      try {
        const tools = await client.listTools();
        result[serverId] = tools;
      } catch (error) {
        console.error(`サーバー ${serverId} のツール取得エラー:`, error instanceof Error ? error.message : String(error));
        result[serverId] = [];
      }
    }
    
    return result;
  }
}