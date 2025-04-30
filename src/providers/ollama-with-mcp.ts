/**
 * MCP対応Ollamaプロバイダー
 * Model Context Protocolとの統合機能を持つOllamaプロバイダー
 */

import { OllamaProvider } from './ollama';
import { OllamaMCPBridge, OllamaTool } from '../mcp/ollama-bridge';

interface OllamaWithMCPConfig {
  baseURL?: string;
  model?: string;
  mcpEnabled?: boolean;
  [key: string]: any;
}

interface ChatMessage {
  role: string;
  content: string;
}

interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

interface ChatCompletionOptions {
  temperature?: number;
  max_tokens?: number;
  tools?: OllamaTool[];
  tool_choice?: string | { type: string; function: { name: string } };
  [key: string]: any;
}

interface ChatCompletionResponse {
  choices: {
    message: {
      role: string;
      content: string;
      tool_calls?: ToolCall[];
    };
    index: number;
    finish_reason: string;
  }[];
  [key: string]: any;
}

export class OllamaWithMCPProvider extends OllamaProvider {
  private mcpBridge: OllamaMCPBridge | null = null;
  private mcpEnabled: boolean = false;

  constructor(config: OllamaWithMCPConfig) {
    super(config);
    this.mcpEnabled = config.mcpEnabled ?? false;
    
    if (this.mcpEnabled) {
      this.mcpBridge = new OllamaMCPBridge();
    }
  }

  /**
   * ツール機能を有効にしたチャット完了
   * @param messages メッセージリスト
   * @param options オプション
   * @returns チャット完了レスポンス
   */
  async chatCompletionWithTools(messages: ChatMessage[], options: ChatCompletionOptions = {}): Promise<ChatCompletionResponse> {
    // MCP無効時は通常のモデル呼び出し
    if (!this.mcpEnabled || !this.mcpBridge) {
      return super.chatCompletion(messages, options);
    }

    try {
      // MCPツールをロード
      const { tools, servers } = await this.mcpBridge.getOllamaTools();
      console.log(`${tools.length}個のMCPツールをロードしました (サーバー: ${servers.join(', ')})`);

      // ツールの定義をオプションにマージ
      const optionsWithTools = {
        ...options,
        tools
      };

      // Ollamaモデルを呼び出し
      const completion = await super.chatCompletion(messages, optionsWithTools);

      // ツール呼び出しがあるか確認
      if (completion.choices && completion.choices[0] && completion.choices[0].message.tool_calls) {
        // ツール呼び出しを処理
        return await this.processToolCalls(completion, messages);
      }

      return completion;
    } catch (error) {
      console.error('ツール付きチャット完了エラー:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * ツール呼び出しを処理して結果を返す
   * @param completion モデルからの応答
   * @param messages 元のメッセージリスト
   * @returns 更新されたレスポンス
   */
  private async processToolCalls(completion: ChatCompletionResponse, messages: ChatMessage[]): Promise<ChatCompletionResponse> {
    if (!this.mcpBridge) {
      throw new Error('MCPブリッジが初期化されていません');
    }

    const toolCalls = completion.choices[0].message.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      return completion;
    }

    console.log(`${toolCalls.length}個のツール呼び出しを処理します`);

    // 新しいメッセージリストを用意（元のメッセージ + アシスタントの応答 + ツール呼び出し結果）
    const newMessages = [...messages];
    
    // アシスタントのレスポンスをメッセージに追加
    newMessages.push({
      role: 'assistant',
      content: completion.choices[0].message.content || '',
      ...completion.choices[0].message // tool_callsを含める
    } as any);

    // 各ツール呼び出しを処理して結果をメッセージに追加
    for (const toolCall of toolCalls) {
      if (toolCall.function) {
        const toolName = toolCall.function.name;
        let args: Record<string, any> = {};
        
        try {
          // ツール引数をJSONからパース
          args = JSON.parse(toolCall.function.arguments);
        } catch (e) {
          console.warn('ツール引数のパースに失敗:', e);
        }
        
        try {
          // MCPツールを呼び出し
          const toolResult = await this.mcpBridge.callOllamaTool(toolName, args);
          
          // ツール結果をメッセージに追加
          newMessages.push({
            role: 'tool',
            content: toolResult.result,
            tool_call_id: toolCall.id
          } as any);
          
          console.log(`ツール "${toolName}" 実行結果:`, toolResult.result.substring(0, 100) + (toolResult.result.length > 100 ? '...' : ''));
        } catch (error) {
          console.error(`ツール "${toolName}" 呼び出しエラー:`, error instanceof Error ? error.message : String(error));
          
          // エラーをメッセージに追加
          newMessages.push({
            role: 'tool',
            content: `ツール呼び出しエラー: ${error instanceof Error ? error.message : String(error)}`,
            tool_call_id: toolCall.id
          } as any);
        }
      }
    }

    // 更新されたメッセージでモデルを再度呼び出し
    return super.chatCompletion(newMessages);
  }

  /**
   * MCPブリッジを初期化
   * @returns 初期化されたサーバーIDのリスト
   */
  async initializeMCP(): Promise<string[]> {
    if (!this.mcpEnabled || !this.mcpBridge) {
      console.warn('MCPが有効になっていません');
      return [];
    }

    return this.mcpBridge.initialize();
  }

  /**
   * MCPブリッジをシャットダウン
   */
  async shutdownMCP(): Promise<void> {
    if (this.mcpBridge) {
      await this.mcpBridge.shutdown();
    }
  }
}