// src/mcp/ollama-bridge.ts
/**
 * OllamaMCPブリッジ - OllamaをMCPサーバーとして公開
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import * as fs from 'fs';
import * as path from 'path';

// Ollamaツール定義
export interface OllamaTool {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * OllamaMCPブリッジ - OllamaをMCPサーバーとして公開するブリッジ
 */
export class OllamaMCPBridge {
  private ollamaBaseUrl: string;
  private ollamaModel: string;
  private toolsCache: Record<string, any> = {};
  private sdkClient: Client | null = null;
  
  constructor(options: { baseUrl: string; model: string }) {
    this.ollamaBaseUrl = options.baseUrl || 'http://localhost:11434/v1';
    this.ollamaModel = options.model || 'codellama:7b-instruct';
  }
  
  /**
   * 接続先のOllamaサーバー情報を設定
   */
  setOllamaInfo(baseUrl: string, model: string): void {
    this.ollamaBaseUrl = baseUrl;
    this.ollamaModel = model;
  }

  /**
   * SDKクライアントを設定
   */
  setSdkClient(client: Client): void {
    this.sdkClient = client;
  }
  
  /**
   * Ollamaサーバーに接続できるか確認
   */
  async checkConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaBaseUrl}/models`);
      if (!response.ok) {
        throw new Error(`Ollamaサーバーからのエラーレスポンス: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      return Array.isArray(data.models) && data.models.length > 0;
    } catch (error) {
      console.error('Ollamaサーバー接続エラー:', error instanceof Error ? error.message : String(error));
      return false;
    }
  }
  
  /**
   * 初期化
   * @returns 初期化されたサーバーIDのリスト
   */
  async initialize(): Promise<string[]> {
    try {
      const isConnected = await this.checkConnection();
      if (isConnected) {
        // 接続成功時はサーバーIDの配列を返す
        return ['ollama'];
      }
      return [];
    } catch (error) {
      console.error('OllamaMCPブリッジ初期化エラー:', error);
      return [];
    }
  }
  
  /**
   * シャットダウン
   */
  async shutdown(): Promise<void> {
    // 必要に応じてリソースを解放
    console.log('OllamaMCPブリッジをシャットダウンしています...');
  }
  
  /**
   * Ollamaツールのリストを取得
   */
  async getOllamaTools(): Promise<{ tools: OllamaTool[], servers: string[] }> {
    // Ollamaモデルをツールとして公開
    try {
      const response = await fetch(`${this.ollamaBaseUrl}/models`);
      if (!response.ok) {
        throw new Error(`Ollamaサーバーからのエラーレスポンス: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      const models = Array.isArray(data.models) ? data.models : [];
      
      // Ollamaモデルをツールとして定義
      const tools: OllamaTool[] = models.map((model: any) => ({
        name: `ollama_${model.name.replace(/[^a-zA-Z0-9_]/g, '_')}`,
        description: `Ollama LLM: ${model.name} - ${model.size || 'N/A'} パラメータ`,
        parameters: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'モデルに送信するプロンプト'
            },
            options: {
              type: 'object',
              description: '生成オプション（temperature、top_pなど）',
              properties: {}
            }
          },
          required: ['prompt']
        }
      }));
      
      // 追加のツール
      tools.push({
        name: 'ollama_chat',
        description: 'Ollamaモデルとチャット形式で対話',
        parameters: {
          type: 'object',
          properties: {
            messages: {
              type: 'array',
              description: 'チャットメッセージ（role, contentの配列）',
              items: {
                type: 'object',
                properties: {
                  role: {
                    type: 'string',
                    description: 'メッセージの役割（system, user, assistant）'
                  },
                  content: {
                    type: 'string',
                    description: 'メッセージの内容'
                  }
                }
              }
            },
            model: {
              type: 'string',
              description: '使用するモデル名'
            },
            options: {
              type: 'object',
              description: '生成オプション（temperature、top_pなど）',
              properties: {}
            }
          },
          required: ['messages']
        }
      });
      
      return {
        tools,
        servers: ['ollama']
      };
    } catch (error) {
      console.error('Ollamaツール取得エラー:', error);
      return { tools: [], servers: [] };
    }
  }
  
  /**
   * Ollamaツールを呼び出す
   * @param toolName ツール名
   * @param args ツール引数
   * @returns ツール実行結果
   */
  async callOllamaTool(toolName: string, args: Record<string, any>): Promise<any> {
    if (toolName === 'ollama_chat') {
      // チャットエンドポイントを使用
      return this.callOllamaChat(args.messages, args.model || this.ollamaModel, args.options);
    } else if (toolName.startsWith('ollama_')) {
      // モデル名を取得（ツール名からollama_プレフィックスを削除）
      const modelName = toolName.substring(7).replace(/_/g, ':');
      
      // 完了エンドポイントを使用
      return this.callOllamaCompletion(args.prompt, modelName, args.options);
    } else {
      throw new Error(`未知のOllamaツール: ${toolName}`);
    }
  }
  
  /**
   * Ollamaチャットを呼び出す
   */
  private async callOllamaChat(messages: any[], model: string, options: any = {}): Promise<any> {
    try {
      const response = await fetch(`${this.ollamaBaseUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model || this.ollamaModel,
          messages,
          options
        })
      });
      
      if (!response.ok) {
        throw new Error(`Ollamaサーバーエラー: ${response.status} ${response.statusText}`);
      }
      
      const result = await response.json();
      
      return {
        content: [{
          type: 'text',
          text: result.message?.content || JSON.stringify(result)
        }],
        isError: false
      };
    } catch (error) {
      console.error('Ollamaチャット呼び出しエラー:', error);
      return {
        content: [{
          type: 'text',
          text: `エラー: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  }
  
  /**
   * Ollama完了を呼び出す
   */
  private async callOllamaCompletion(prompt: string, model: string, options: any = {}): Promise<any> {
    try {
      const response = await fetch(`${this.ollamaBaseUrl}/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model || this.ollamaModel,
          prompt,
          options
        })
      });
      
      if (!response.ok) {
        throw new Error(`Ollamaサーバーエラー: ${response.status} ${response.statusText}`);
      }
      
      const result = await response.json();
      
      return {
        content: [{
          type: 'text',
          text: result.choices?.[0]?.text || result.completion || JSON.stringify(result)
        }],
        isError: false
      };
    } catch (error) {
      console.error('Ollama完了呼び出しエラー:', error);
      return {
        content: [{
          type: 'text',
          text: `エラー: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      };
    }
  }
}