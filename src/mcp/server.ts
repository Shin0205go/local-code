/**
 * MCPサーバーマネージャー
 * MCPサーバーの起動・停止・管理を行う
 */

import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { ServerConfigManager, ServerConfig } from './config.js';

// MCPサーバーオプション
export interface MCPServerOptions {
  // ログレベル: debugは詳細表示、quietは非表示
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'quiet' | string;
}

// MCPサーバーマネージャークラス
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
  async startServer(config: ServerConfig, options: MCPServerOptions = {}): Promise<void> {
    // すでに起動している場合は何もしない
    if (this.servers.has(config.id)) {
      console.log(`サーバー ${config.id} はすでに起動しています`);
      return;
    }
    
    // サーバーが実行可能かどうか確認
    if (!config.command) {
      throw new Error(`サーバー ${config.id} のコマンドが指定されていません`);
    }
    
    try {
      // 環境変数にログレベルを追加
      const env = {
        ...process.env,
        ...config.env,
        // MCPログレベル設定
        MCP_LOG_LEVEL: options.logLevel === 'quiet' ? 'error' : (options.logLevel === 'debug' ? 'debug' : 'info'),
        // デバッグフラグ
        DEBUG: options.logLevel === 'debug' ? '1' : '0',
        // 静音モード
        QUIET: options.logLevel === 'quiet' ? '1' : '0',
        // ロガー設定
        NODE_ENV: options.logLevel === 'debug' ? 'development' : 'production'
      };
      
      // 子プロセス起動
      const childProcess = spawn(config.command, config.args || [], {
        env,
        // stdio設定: stdin, stdout, stderr
        stdio: options.logLevel === 'quiet' ? ['pipe', 'pipe', 'ignore'] : ['pipe', 'pipe', 'pipe']
      });
      
      // プロセスIDを記録
      this.servers.set(config.id, childProcess);
      
      // サーバーIDとPIDをログ出力（quietでなければ）
      if (options.logLevel !== 'quiet') {
        console.log(`サーバー ${config.id} を起動しました (PID: ${childProcess.pid})`);
      }
      
      // 終了時のクリーンアップ
      childProcess.on('close', (code) => {
        // ここもquietでなければログ出力
        if (options.logLevel !== 'quiet') {
          console.log(`サーバー ${config.id} が終了しました (コード: ${code})`);
        }
        this.servers.delete(config.id);
      });
      
      // エラーハンドリング
      childProcess.on('error', (error) => {
        console.error(`サーバー ${config.id} でエラーが発生しました:`, error.message);
        this.servers.delete(config.id);
      });
      
      // quietモードでなければstderrをコンソールに表示
      if (options.logLevel !== 'quiet') {
        childProcess.stderr?.on('data', (data) => {
          // [サーバーID] プレフィックスを追加して出力
          if (options.logLevel === 'debug') {
            console.error(`[${config.id}] ${data.toString().trim()}`);
          } else {
            // infoモード以上の場合はDEBUG行をフィルタリング
            const lines = data.toString().trim().split('\n');
            for (const line of lines) {
              if (!line.includes('[DEBUG]') && !line.includes('DEBUG:')) {
                console.error(`[${config.id}] ${line}`);
              }
            }
          }
        });
      }
      
      // 初期化を待機
      await new Promise<void>((resolve, reject) => {
        // 5秒のタイムアウト
        const timeout = setTimeout(() => {
          resolve(); // タイムアウトしても成功と判断
        }, 5000);
        
        // 子プロセスの初期メッセージを待機
        childProcess.stdout?.on('data', () => {
          clearTimeout(timeout);
          resolve();
        });
        
        // 即時エラーの場合
        childProcess.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        
        // 即時終了の場合
        childProcess.on('close', (code) => {
          if (code !== 0) {
            clearTimeout(timeout);
            reject(new Error(`サーバー ${config.id} の起動に失敗しました (code: ${code})`));
          }
        });
      });
    } catch (error) {
      console.error(`サーバー ${config.id} の起動に失敗:`, error instanceof Error ? error.message : String(error));
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
    
    // console.log(`サーバー ${serverId} を停止しました`);
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