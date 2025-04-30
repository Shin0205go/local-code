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
}

/**
 * MCPクライアント
 */
export class MCPClient {
  private serverUrl: string;
  private timeout: number;
  private jsonRpcId: number = 1;

  /**
   * MCPクライアントを初期化
   * @param config クライアント設定
   */
  constructor(config: MCPClientConfig) {
    this.serverUrl = config.serverUrl;
    this.timeout = config.timeout || 30000; // デフォルトタイムアウト: 30秒
  }

  /**
   * 利用可能なツールのリストを取得
   * @returns ツールのリスト
   */
  async listTools(): Promise<MCPTool[]> {
    try {
      const fetch = await fetchModule();
      
      const requestId = this.getNextId();
      const response = await this.sendJsonRpcRequest(
        'tools/list',
        {},
        requestId
      );

      const { result } = await response.json();
      
      if (!result || !result.tools) {
        console.warn('MCPサーバーからツールリストを取得できませんでした');
        return [];
      }

      return result.tools;
    } catch (error) {
      console.error('MCPツールリスト取得エラー:', error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  /**
   * ツールを呼び出す
   * @param toolName ツール名
   * @param args ツール引数
   * @returns ツール実行結果
   */
  async callTool(toolName: string, args: Record<string, any>): Promise<MCPToolResult> {
    try {
      const requestId = this.getNextId();
      const response = await this.sendJsonRpcRequest(
        'tools/call',
        {
          name: toolName,
          arguments: args
        },
        requestId
      );

      const { result, error } = await response.json();
      
      if (error) {
        console.error(`MCPツール呼び出しエラー:`, error);
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
      console.error('MCPツール呼び出しエラー:', error instanceof Error ? error.message : String(error));
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

    const response = await fetch(this.serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      timeout: this.timeout
    });

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
}