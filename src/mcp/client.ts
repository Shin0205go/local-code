// src/mcp/client.ts
/**
 * MCP SDK直接使用版の実装
 * MCPClient/MCPMultiClientは削除し、代わりにSDKを直接使用
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ServerConfig } from "./config.js";
import { EmptyResultSchema } from "@modelcontextprotocol/sdk/types.js";

// 型定義だけ保持
export interface MCPTool {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

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
 * MCP SDKのClientを生成する
 * @param config サーバー設定
 * @returns MCP Client
 */
export async function createMcpClient(config: ServerConfig): Promise<Client> {
  // MCP SDKのStdioClientTransportを作成
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args || [],
    env: config.env ? { ...config.env } : undefined
  });
  
  // MCP SDKのClientを初期化
  const client = new Client(
    {
      name: "ollama-code-client",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );
  
  // クライアントを接続
  await client.connect(transport);
  return client;
}

/**
 * 指定されたツールをサポートするサーバーIDを探す
 * @param clients クライアントマップ
 * @param toolName ツール名
 * @returns サーバーIDまたはundefined
 */
export async function findServerForTool(
  clients: Map<string, Client>,
  toolName: string
): Promise<string | undefined> {
  for (const [serverId, client] of clients.entries()) {
    try {
      const toolsResult = await client.listTools();
      if (toolsResult.tools.some(tool => tool.name === toolName)) {
        return serverId;
      }
    } catch (error) {
      console.error(`サーバー ${serverId} からツールリストを取得できませんでした:`, error);
    }
  }
  return undefined;
}

/**
 * 全サーバーからツールリストを取得
 * @param clients クライアントマップ
 * @returns サーバーID => ツールリストのマップ
 */
export async function getAllTools(
  clients: Map<string, Client>
): Promise<Record<string, any[]>> {
  const result: Record<string, any[]> = {};
  
  for (const [serverId, client] of clients.entries()) {
    try {
      const toolsResult = await client.listTools();
      result[serverId] = toolsResult.tools;
    } catch (error) {
      console.error(`サーバー ${serverId} のツール取得エラー:`, error instanceof Error ? error.message : String(error));
      result[serverId] = [];
    }
  }
  
  return result;
}

/**
 * ツールを呼び出す
 * @param clients クライアントマップ
 * @param toolName ツール名
 * @param args ツール引数
 * @returns ツール実行結果
 */
export async function callTool(
  clients: Map<string, Client>,
  toolName: string,
  args: Record<string, any>
): Promise<any> {
  // ツールをサポートしているサーバーを見つける
  const serverId = await findServerForTool(clients, toolName);
  
  if (!serverId) {
    throw new Error(`ツール "${toolName}" をサポートしているサーバーが見つかりません`);
  }
  
  // ツールを呼び出す
  const client = clients.get(serverId);
  if (!client) {
    throw new Error(`サーバー "${serverId}" のクライアントが見つかりません`);
  }
  
  console.log(`サーバー ${serverId} でツール ${toolName} を実行中...`);
  try {
    const result = await client.callTool({
      name: toolName,
      arguments: args
    });
    
    return result;
  } catch (error) {
    console.error(`ツール ${toolName} の実行中にエラーが発生しました:`, error);
    throw error;
  }
}