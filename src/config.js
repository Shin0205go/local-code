import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.ollama-code');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export function loadConfig() {
  // 設定ファイルが存在しない場合、デフォルト設定を作成
  if (!fs.existsSync(CONFIG_FILE)) {
    return {
      provider: 'ollama',
      model: 'codellama:7b-instruct',
      baseURL: 'http://localhost:11434/v1',
      sandbox: {
        type: 'none',
        options: {}
      },
      mcp: {
        enabled: false
      }
    };
  }
  
  // 設定を読み込み
  try {
    const configStr = fs.readFileSync(CONFIG_FILE, 'utf8');
    const config = JSON.parse(configStr);
    
    // 後方互換性のための変換
    if (typeof config.sandbox === 'string') {
      config.sandbox = {
        type: config.sandbox,
        options: {}
      };
    }
    
    // MCPがない場合は追加
    if (!config.mcp) {
      config.mcp = {
        enabled: false
      };
    }
    
    return config;
  } catch (error) {
    console.error('設定の読み込みエラー:', error.message);
    return {
      provider: 'ollama',
      model: 'codellama:7b-instruct',
      baseURL: 'http://localhost:11434/v1',
      sandbox: {
        type: 'none',
        options: {}
      },
      mcp: {
        enabled: false
      }
    };
  }
}

export function saveConfig(config) {
  // 設定ディレクトリが存在しない場合は作成
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  
  // 設定を保存
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}