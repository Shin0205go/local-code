/**
 * MCPサーバーの起動と管理を行うモジュール
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { ServerConfigManager, ServerConfig } from './config';

export class MCPServerManager {
  private configManager: ServerConfigManager;
  private serverProcesses: Map<string, ChildProcess> = new Map();
  private configPath: string;

  /**
   * MCPサーバーマネージャーを初期化
   * @param configPath 設定ファイルパス、指定しない場合はデフォルトパス
   */
  constructor(configPath?: string) {
    this.configPath = configPath || path.join(process.cwd(), 'config/mcp-config.json');
    this.configManager = new ServerConfigManager(this.configPath);
  }

  /**
   * 設定ファイルからMCPサーバー設定をロード
   */
  async loadServerConfigs(): Promise<ServerConfig[]> {
    try {
      // ファイルが存在するか確認
      try {
        await fs.access(this.configPath);
      } catch (e) {
        console.warn(`Config file not found at ${this.configPath}`);
        return [];
      }

      // 設定マネージャーから設定を読み込む
      await this.configManager.load();
      return this.configManager.getServers();
    } catch (error) {
      console.error('Failed to load MCP server config:', error);
      return [];
    }
  }

  /**
   * MCPサーバーを起動する
   * @param serverConfig サーバー設定
   * @param debug デバッグ出力を表示するか
   * @returns 起動したプロセス
   */
  async startServer(serverConfig: ServerConfig, debug: boolean = false): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
      try {
        console.log(`Starting MCP Server: ${serverConfig.id}`, 
          debug ? `\n  Command: ${serverConfig.command} ${serverConfig.args?.join(' ')}` : '');

        // プロセス起動
        const mcpServer = spawn(serverConfig.command, serverConfig.args || [], {
          env: { ...process.env, ...serverConfig.env },
          cwd: serverConfig.cwd || process.cwd(),
          stdio: ['pipe', 'pipe', 'pipe']
        });

        // プロセスを保存
        this.serverProcesses.set(serverConfig.id, mcpServer);

        // ログ出力
        mcpServer.stdout.on('data', (data) => {
          const output = data.toString().trim();
          if (output) {
            if (debug) {
              console.log(`[${serverConfig.id}:stdout] ${output}`);
            } else if (output.includes('Error') || output.includes('error')) {
              console.log(`[${serverConfig.id}:info] ${output}`);
            }
          }
        });

        mcpServer.stderr.on('data', (data) => {
          const error = data.toString().trim();
          if (error) console.error(`[${serverConfig.id}:stderr] ${error}`);
        });

        // エラー処理
        mcpServer.on('error', (error) => {
          console.error(`Failed to start MCP server ${serverConfig.id}:`, error);
          this.serverProcesses.delete(serverConfig.id);
          reject(error);
        });

        // プロセス終了時の処理
        mcpServer.on('close', (code) => {
          console.log(`MCP Server ${serverConfig.id} exited with code ${code}`);
          this.serverProcesses.delete(serverConfig.id);
        });

        // 少し待ってからプロセスを返す（起動完了を待つ）
        setTimeout(() => resolve(mcpServer), 2000);
      } catch (error) {
        console.error(`Error starting MCP server ${serverConfig.id}:`, error);
        reject(error);
      }
    });
  }

  /**
   * 指定したサーバーを起動
   * @param serverId サーバーID
   * @param debug デバッグ出力を表示するか
   * @returns 起動したプロセス
   */
  async startServerById(serverId: string, debug: boolean = false): Promise<ChildProcess> {
    // 最新の設定を読み込む
    await this.configManager.load();
    const servers = this.configManager.getServers();
    
    // サーバーIDをチェック
    const serverConfig = servers.find(s => s.id === serverId);
    if (!serverConfig) {
      throw new Error(`Server "${serverId}" not found in configuration`);
    }

    // すでに起動しているサーバーを終了
    if (this.serverProcesses.has(serverId)) {
      await this.stopServer(serverId);
    }

    return this.startServer(serverConfig, debug);
  }

  /**
   * サーバープロセスを停止
   * @param serverId サーバーID
   */
  async stopServer(serverId: string): Promise<void> {
    const serverProcess = this.serverProcesses.get(serverId);
    if (serverProcess) {
      console.log(`Stopping MCP server: ${serverId}`);
      serverProcess.kill('SIGTERM');
      
      // プロセスが終了するのを待つ
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (!this.serverProcesses.has(serverId)) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 100);
        
        // タイムアウト（3秒後）
        setTimeout(() => {
          clearInterval(checkInterval);
          if (this.serverProcesses.has(serverId)) {
            console.warn(`Server ${serverId} did not exit gracefully, forcing termination`);
            this.serverProcesses.delete(serverId);
          }
          resolve();
        }, 3000);
      });
    }
  }

  /**
   * すべてのサーバープロセスを停止
   */
  async stopAllServers(): Promise<void> {
    const serverIds = Array.from(this.serverProcesses.keys());
    console.log(`Stopping ${serverIds.length} MCP server processes...`);
    
    for (const serverId of serverIds) {
      await this.stopServer(serverId);
    }
  }

  /**
   * サーバーが起動しているかチェック
   * @param serverId サーバーID
   */
  isServerRunning(serverId: string): boolean {
    return this.serverProcesses.has(serverId);
  }

  /**
   * 起動中のサーバー一覧を取得
   */
  getRunningServers(): string[] {
    return Array.from(this.serverProcesses.keys());
  }

  /**
   * サーバープロセスを取得
   * @param serverId サーバーID
   */
  getServerProcess(serverId: string): ChildProcess | undefined {
    return this.serverProcesses.get(serverId);
  }
}