/**
 * プロセス状態の永続化を管理するモジュール
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

// アプリケーションのルートディレクトリを取得するヘルパー関数
function getAppRootDir() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '../..');
}

// プロセス状態ファイルのパス
const PROCESS_STATE_DIR = path.join(os.homedir(), '.ollama-code');
const PROCESS_STATE_FILE = path.join(PROCESS_STATE_DIR, 'mcp-processes.json');

/**
 * プロセス状態マネージャー
 */
export class ProcessManager {
  constructor() {
    this.processes = {};
    this.initialized = false;
  }

  /**
   * 初期化 - プロセス状態ファイルを読み込む
   */
  async init() {
    if (this.initialized) return;
    
    try {
      // ディレクトリが存在しない場合は作成
      try {
        await fs.access(PROCESS_STATE_DIR);
      } catch (e) {
        await fs.mkdir(PROCESS_STATE_DIR, { recursive: true });
      }
      
      // ファイルが存在する場合は読み込む
      try {
        await fs.access(PROCESS_STATE_FILE);
        const data = await fs.readFile(PROCESS_STATE_FILE, 'utf-8');
        this.processes = JSON.parse(data);
        
        // プロセスが実際に実行中かチェック
        for (const [id, info] of Object.entries(this.processes)) {
          const pid = info.pid;
          if (pid && !this.isProcessRunning(pid)) {
            delete this.processes[id];
          }
        }
      } catch (e) {
        // ファイルがない場合は空のプロセス状態で始める
        this.processes = {};
      }
      
      this.initialized = true;
    } catch (error) {
      console.error('プロセス状態の初期化エラー:', error);
      this.processes = {};
      this.initialized = true;
    }
    
    return this.processes;
  }

  /**
   * プロセス状態を保存
   */
  async save() {
    if (!this.initialized) await this.init();
    
    try {
      await fs.writeFile(PROCESS_STATE_FILE, JSON.stringify(this.processes, null, 2));
    } catch (error) {
      console.error('プロセス状態の保存エラー:', error);
    }
  }

  /**
   * プロセスを登録
   * @param {string} id プロセスID
   * @param {object} process プロセス情報
   */
  async registerProcess(id, processInfo) {
    if (!this.initialized) await this.init();
    
    this.processes[id] = {
      pid: processInfo.pid,
      command: processInfo.command,
      startTime: new Date().toISOString(),
      ...processInfo
    };
    
    await this.save();
  }

  /**
   * プロセスを削除
   * @param {string} id プロセスID
   */
  async unregisterProcess(id) {
    if (!this.initialized) await this.init();
    
    if (this.processes[id]) {
      delete this.processes[id];
      await this.save();
    }
  }

  /**
   * プロセスが実行中かチェック
   * @param {number} pid プロセスID
   * @returns {boolean} 実行中かどうか
   */
  isProcessRunning(pid) {
    try {
      // Linuxでは、プロセスに0のシグナルを送信することで存在確認
      // シグナルが送信できれば、プロセスは存在する
      process.kill(pid, 0);
      return true;
    } catch (e) {
      // プロセスが存在しない場合はEPERMエラーではなくESOERCHエラー
      return e.code === 'EPERM';
    }
  }

  /**
   * 登録されたプロセスが実行中かチェック
   * @param {string} id プロセスID
   * @returns {boolean} 実行中かどうか
   */
  isRegisteredProcessRunning(id) {
    if (!this.processes[id]) return false;
    
    const pid = this.processes[id].pid;
    if (!pid) return false;
    
    return this.isProcessRunning(pid);
  }

  /**
   * 登録されたすべてのプロセスを取得
   * @returns {object} 登録されたプロセス
   */
  getRegisteredProcesses() {
    return this.processes;
  }
}

// シングルトンインスタンスをエクスポート
export const processManager = new ProcessManager();
