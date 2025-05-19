/**
 * MCP対応Ollamaプロバイダー
 * Model Context Protocolとの統合機能を持つOllamaプロバイダー
 */

import { OllamaProvider } from './ollama.js';
import { OllamaMCPBridge, OllamaTool } from '../mcp/ollama-bridge.js';
// ollama公式パッケージから必要な型をインポート
import { ChatResponse } from 'ollama';

// ChatResponse型とChatCompletionResponse型の互換性を確保するアダプター関数
function adaptToCompletionResponse(response: ChatResponse | any): ChatCompletionResponse {
  // すでにChatCompletionResponse形式なら変換しない
  if (response.choices && Array.isArray(response.choices)) {
    return response as ChatCompletionResponse;
  }
  
  return {
    choices: [{
      message: {
        role: response.message.role,
        content: response.message.content,
        // tool_callsがあれば追加
        ...(response.message.tool_calls ? { tool_calls: response.message.tool_calls } : {})
      },
      index: 0,
      finish_reason: "stop"
    }]
  };
}

interface OllamaWithMCPConfig {
  baseURL?: string;
  model?: string;
  mcpEnabled?: boolean;
  [key: string]: any;
}

interface ChatMessage {
  role: string;
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  [key: string]: any; // 他の可能性のあるプロパティ
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
    message: ChatMessage;
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
    
    // MCPブリッジを初期化
    this.mcpBridge = new OllamaMCPBridge({
      baseUrl: config.baseURL || 'http://localhost:11434/v1',
      model: config.model || 'qwen3'
    });
    
    // MCP有効/無効の設定
    this.mcpEnabled = config.mcpEnabled !== undefined ? config.mcpEnabled : false;
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
      const response = await super.chatCompletion(messages, options);
      // 応答をChatCompletionResponse型に変換
      return adaptToCompletionResponse(response as ChatResponse);
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
      const chatResponse = await super.chatCompletion(messages, optionsWithTools);
      const completion = adaptToCompletionResponse(chatResponse as ChatResponse);

      // ツール呼び出しがあるか確認
      if (completion.choices && 
          completion.choices[0] && 
          completion.choices[0].message && 
          'tool_calls' in completion.choices[0].message && 
          completion.choices[0].message.tool_calls) {
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
    // スプレッド演算子を先に使用して、後から特定のプロパティを上書きしないようにする
    const messageWithToolCalls = {
      ...completion.choices[0].message,
      role: 'assistant' // 明示的に役割を設定
    };
    
    // contentが空文字列の場合でも明示的に設定する
    if (messageWithToolCalls.content === undefined) {
      messageWithToolCalls.content = '';
    }
    
    newMessages.push(messageWithToolCalls as ChatMessage);

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

          const resultText = Array.isArray(toolResult.content)
            ? toolResult.content.map((c: any) => c.text || '').join('\n')
            : String(toolResult);

          // ツール結果をメッセージに追加
          newMessages.push({
            role: 'tool',
            content: resultText,
            tool_call_id: toolCall.id
          } as ChatMessage);

          console.log(`ツール "${toolName}" 実行結果:`, resultText.substring(0, 100) + (resultText.length > 100 ? '...' : ''));
        } catch (error) {
          console.error(`ツール "${toolName}" 呼び出しエラー:`, error instanceof Error ? error.message : String(error));
          
          // エラーをメッセージに追加
          newMessages.push({
            role: 'tool',
            content: `ツール呼び出しエラー: ${error instanceof Error ? error.message : String(error)}`,
            tool_call_id: toolCall.id
          } as ChatMessage);
        }
      }
    }

    // 更新されたメッセージでモデルを再度呼び出し
    const chatResponse = await super.chatCompletion(newMessages);
    // 応答をChatCompletionResponse型に変換して返す
    return adaptToCompletionResponse(chatResponse as ChatResponse);
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