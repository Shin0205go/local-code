// Ollamaプロバイダー
import type { Response } from 'node-fetch';

const fetchModule = () => import('node-fetch').then(({default: fetch}) => fetch);

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
  
  async chatCompletion(messages: any[], options: OllmaChatCompletionOptions = {}): Promise<OllamaChatCompletionResponse> {
    try {
      const fetch = await fetchModule();
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages: messages,
          stream: false,
          ...options
        })
      });
      
      if (!response.ok) {
        throw new Error(`API要求に失敗: ${response.statusText}`);
      }
      
      const data = await response.json() as OllamaChatCompletionResponse;
      return data;
    } catch (error) {
      console.error('チャット完了エラー:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}