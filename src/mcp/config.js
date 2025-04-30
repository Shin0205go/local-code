import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// アプリケーションのルートディレクトリを取得するヘルパー関数
function getAppRootDir() {
  // ESモジュールでは __dirname が使えないため、fileURLToPath で代用
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // src/mcp から2階層上がルートディレクトリ
  return path.resolve(__dirname, '../..');
}

export class ServerConfigManager {
  constructor(configPath) {
    this.configPath = configPath || path.join(getAppRootDir(), 'config/mcp-config.json');
    this.config = { servers: [] };
  }

  /**
   * 設定ファイルを読み込む
   */
  async load() {
    try {
      // 絶対パスに変換
      const absoluteConfigPath = path.resolve(this.configPath);
      
      // ファイルが存在するか確認
      try {
        await fs.access(absoluteConfigPath);
      } catch (e) {
        console.warn(`設定ファイルが見つかりません: ${absoluteConfigPath}`);
        this.config.servers = [];
        return; // ファイルがない場合は空の設定で続行
      }
      
      const content = await fs.readFile(absoluteConfigPath, 'utf-8');
      const rawConfig = JSON.parse(content);

      // 設定ファイルのフォーマットをチェック
      if (rawConfig.mcpServers) {
        // mcpServersオブジェクトから配列に変換
        const serverEntries = Object.entries(rawConfig.mcpServers);
        this.config.servers = serverEntries.map(([id, config]) => ({
          id,
          name: config.name || id, // nameがない場合はidを使用
          command: config.command,
          args: config.args || [],
          env: config.env || {},
          cwd: config.cwd || process.cwd(),
          capabilities: config.capabilities || []
        }));
      } else if (rawConfig.servers) {
        // すでに配列形式の場合
        this.config.servers = rawConfig.servers;
      } else {
        console.warn('不正な設定形式: mcpServersまたはserversプロパティがありません');
        this.config.servers = []; // 不正な形式の場合も空の設定で続行
        return;
      }

      if (this.config.servers.length === 0) {
        console.warn('設定ファイルにサーバー設定が見つかりません');
      } else {
        console.log(`${absoluteConfigPath}から${this.config.servers.length}個のサーバー設定を読み込みました`);
      }
    } catch (error) {
      console.error('サーバー設定の読み込みに失敗しました:', error);
      // エラー時に空の設定で続行
      this.config.servers = [];
    }
  }

  /**
   * サーバー設定一覧を取得
   */
  getServers() {
    return this.config.servers;
  }
}