import fs from 'fs/promises';
import path from 'path';

export interface ServerConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  capabilities?: string[];
}

export class ServerConfigManager {
  private config: { servers: ServerConfig[] } = { servers: [] };

  constructor(private configPath: string) {}

  /**
   * 設定ファイルを読み込む
   */
  async load(): Promise<void> {
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
        this.config.servers = serverEntries.map(([id, config]: [string, any]) => ({
          id,
          name: config.name,
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
  getServers(): ServerConfig[] {
    return this.config.servers;
  }
}