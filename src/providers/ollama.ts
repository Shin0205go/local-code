// Ollamaプロバイダー
import { Response } from 'node-fetch';
// ollama公式パッケージをインポート
import ollama from 'ollama';
import { ChatResponse } from 'ollama'; // 必要な型も明示的にインポートする
const fetchModule = () => import('node-fetch').then(({default: fetch}) => fetch);

// ollama.jsの型をChatCompletionResponseに変換するアダプター関数
function adaptResponse(response: ChatResponse): any {
  // ollama.jsのレスポンスを従来の形式に変換
  return {
    choices: [{
      message: {
        role: response.message.role,
        content: response.message.content
      },
      index: 0,
      finish_reason: "stop"
    }]
  };
}

interface OllamaConfig {
  baseURL?: string;
  model?: string;
  [key: string]: any;
}

interface OllamaModel {
  name: string;
  modified_at?: string;
  size?: number;
  [key: string]: any;
}

interface OllamaModelsResponse {
  models: OllamaModel[];
}

interface OllmaChatCompletionOptions {
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  [key: string]: any;
}

interface OllamaChatCompletionResponse {
  choices: {
    message: {
      role: string;
      content: string;
    };
    index: number;
    finish_reason: string;
  }[];
  [key: string]: any;
}

export class OllamaProvider {
  private baseURL: string;
  private model: string;

  constructor(config: OllamaConfig) {
    this.baseURL = config.baseURL || 'http://localhost:11434/v1';
    this.model = config.model || 'codellama:7b-instruct';
  }
  
  async listModels(): Promise<OllamaModel[]> {
    try {
      const fetch = await fetchModule();
      const response = await fetch(`${this.baseURL.replace('/v1', '')}/api/tags`);
      if (!response.ok) {
        throw new Error(`モデル取得に失敗: ${response.statusText}`);
      }
      
      const data = await response.json() as OllamaModelsResponse;
      return data.models || [];
    } catch (error) {
      console.error('モデル取得エラー:', error instanceof Error ? error.message : String(error));
      return [];
    }
  }
  
  async chatCompletion(messages: any[], options: OllmaChatCompletionOptions = {}) {
    try {
      if (options.stream) {
        // ストリーミングモードを直接返す（型変換せずに）
        return ollama.chat({
          model: this.model,
          messages: messages,
          stream: true,
          // その他のオプション
        });
      } else {
        // 非ストリーミングモード
        const response = await ollama.chat({
          model: this.model,
          messages: messages
        });
        // 互換性のために応答を変換
        return adaptResponse(response);
      }
    } catch (error) {
      console.error('Ollama API error:', error);
      throw error;
    }
  }
}