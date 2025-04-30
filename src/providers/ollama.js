// Ollamaプロバイダー
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

export class OllamaProvider {
  constructor(config) {
    this.baseURL = config.baseURL || 'http://localhost:11434/v1';
    this.model = config.model || 'codellama:7b-instruct';
  }
  
  async listModels() {
    try {
      const response = await fetch(`${this.baseURL.replace('/v1', '')}/api/tags`);
      if (!response.ok) {
        throw new Error(`モデル取得に失敗: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.models || [];
    } catch (error) {
      console.error('モデル取得エラー:', error.message);
      return [];
    }
  }
  
  async chatCompletion(messages, options = {}) {
    try {
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
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('チャット完了エラー:', error.message);
      throw error;
    }
  }
}