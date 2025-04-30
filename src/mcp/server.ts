/**
 * MCPサーバーマネージャー
 * MCPサーバーの起動・停止・管理を行う
 */

import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { ServerConfigManager, ServerConfig } from './config.js';

/**
 * MCPサーバーマネージャークラス
 */
export class MCPServerManager {
  private servers: Map<string, ChildProcess>;
  private configManager: ServerConfigManager;
  
  constructor() {
    this.servers = new Map();
    // サーバー設定の読み込み
    const configPath = path.resolve(process.cwd(), 'config', 'mcp-config.json');
    this.configManager = new ServerConfigManager(configPath);
  }
  
  /**
   * サーバー設定を読み込む
   */
  async loadServerConfigs(): Promise<ServerConfig[]> {
    await this.configManager.load();
    return this.configManager.getServers();
  }
  
  /**
   * サーバーを起動する
   */
  async startServer(config: ServerConfig): Promise<void> {
    // すでに起動している場合は何もしない
    if (this.servers.has(config.id)) {
      console.log(`サーバー ${config.id} はすでに起動しています`);
      return;
    }
    
    // コマンドと引数を取得
    const cmd = config.command;
    const args = config.args || [];
    
    // 作業ディレクトリを取得
    const cwd = config.cwd || process.cwd();
    
    // 環境変数を取得
    const env = config.env ? { ...process.env, ...config.env } : process.env;
    
    // サーバープロセスを起動
    try {
      const serverProcess = spawn(cmd, args, {
        cwd,
        env,
        stdio: 'pipe'
      });
      
      // 標準出力と標準エラー出力をログに記録
      if (serverProcess.stdout) {
        serverProcess.stdout.on('data', (data) => {
          console.log(`[${config.id}] ${data.toString().trim()}`);
        });
      }
      
      if (serverProcess.stderr) {
        serverProcess.stderr.on('data', (data) => {
          console.error(`[${config.id}] ERROR: ${data.toString().trim()}`);
        });
      }
      
      // プロセス終了時の処理
      serverProcess.on('close', (code) => {
        console.log(`サーバー ${config.id} が終了しました (コード: ${code})`);
        this.servers.delete(config.id);
      });
      
      // エラー発生時の処理
      serverProcess.on('error', (err) => {
        console.error(`サーバー ${config.id} の起動中にエラーが発生しました:`, err);
        this.servers.delete(config.id);
      });
      
      // サーバーリストに追加
      this.servers.set(config.id, serverProcess);
      
      console.log(`サーバー ${config.id} を起動しました (PID: ${serverProcess.pid})`);
      
      // 起動待機処理
      if (config.startupDelay) {
        await new Promise(resolve => setTimeout(resolve, config.startupDelay));
        console.log(`サーバー ${config.id} の起動待機完了`);
      }
    } catch (error) {
      console.error(`サーバー ${config.id} の起動に失敗しました:`, error);
      throw error;
    }
  }
  
  /**
   * サーバーを停止する
   */
  async stopServer(serverId: string): Promise<void> {
    const serverProcess = this.servers.get(serverId);
    
    if (!serverProcess) {
      console.log(`サーバー ${serverId} は実行されていません`);
      return;
    }
    
    // SIGTERMシグナルを送信して終了
    serverProcess.kill('SIGTERM');
    
    // サーバーリストから削除
    this.servers.delete(serverId);
    
    console.log(`サーバー ${serverId} を停止しました`);
  }
  
  /**
   * すべてのサーバーを停止する
   */
  async stopAllServers(): Promise<void> {
    const promises: Promise<void>[] = [];
    
    for (const serverId of this.servers.keys()) {
      promises.push(this.stopServer(serverId));
    }
    
    await Promise.all(promises);
    console.log('すべてのサーバーを停止しました');
  }
  
  /**
   * サーバーが実行中かどうかを確認
   */
  isServerRunning(serverId: string): boolean {
    return this.servers.has(serverId);
  }
  
  /**
   * 実行中のサーバーIDのリストを取得
   */
  getRunningServers(): string[] {
    return Array.from(this.servers.keys());
  }
  
}