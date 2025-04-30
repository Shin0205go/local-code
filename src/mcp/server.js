import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

// ESモジュールでの__dirnameの代替
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, '../../');

export class MCPServerManager {
  constructor(configPath) {
    this.configPath = configPath || path.join(APP_ROOT, 'config/mcp-config.json');
    this.pidDir = path.join(os.homedir(), '.ollama-code', 'pids');
    this.logDir = path.join(os.homedir(), '.ollama-code', 'logs');
    
    // 必要なディレクトリの作成
    if (!fs.existsSync(this.pidDir)) {
      fs.mkdirSync(this.pidDir, { recursive: true });
    }
    
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }
  
  // MCPクライアントを取得
  async getClient(serverId) {
    // サーバー設定を取得
    const configs = await this.loadServerConfigs();
    const serverConfig = configs.find(config => config.id === serverId);
    
    if (!serverConfig) {
      throw new Error(`MCPサーバー ${serverId} の設定が見つかりません`);
    }
    
    // クライアントインスタンスを作成して返す
    return {
      serverId,
      serverConfig,
      executeTask: async (params) => this.executeTask(serverId, params)
    };
  }
  
  // タスク実行
  async executeTask(serverId, params) {
    const { task, generatedCode, context } = params;
    
    // ログ出力
    console.log('=== MCPサーバーリクエスト ===');
    console.log('サーバーID:', serverId);
    console.log('タスク:', task);
    console.log('コンテキスト:', JSON.stringify(context, null, 2));
    
    // ツール呼び出しを検出するパターン
    const toolCallPattern = /```json\s*\{\s*"action"\s*:\s*"([^"]+)"\s*,\s*"action_input"\s*:\s*(?:"([^"]*)"|(\{[\s\S]*?\}))\s*\}\s*```/g;
    
    // ツール呼び出しを検出
    const toolCalls = [];
    let match;
    
    while ((match = toolCallPattern.exec(generatedCode)) !== null) {
      const actionName = match[1];
      let actionInput = match[2] || match[3]; // 文字列かJSONオブジェクト文字列
      
      // JSONオブジェクトの場合はパース
      if (actionInput && actionInput.startsWith('{')) {
        try {
          actionInput = JSON.parse(actionInput);
        } catch (error) {
          console.error('JSONパースエラー:', error.message);
        }
      }
      
      toolCalls.push({
        action: actionName,
        actionInput
      });
    }
    
    if (toolCalls.length > 0) {
      console.log(`ツール呼び出しを${toolCalls.length}個検出しました:`);
      
      // ツール呼び出しを実行
      const toolResults = [];
      
      for (const toolCall of toolCalls) {
        console.log(`ツール実行: ${toolCall.action}`);
        console.log('入力:', JSON.stringify(toolCall.actionInput, null, 2));
        
        // ツール実行
        try {
          const result = await this.executeToolCall(toolCall.action, toolCall.actionInput);
          toolResults.push({
            action: toolCall.action,
            status: 'success',
            result
          });
        } catch (error) {
          toolResults.push({
            action: toolCall.action,
            status: 'error',
            error: error.message
          });
        }
      }
      
      return {
        toolResults,
        task,
        message: `${toolCalls.length}個のツールを実行しました`
      };
    }
    
    // ツール呼び出しがない場合はそのまま返す
    return {
      message: "ツール呼び出しは検出されませんでした",
      task
    };
  }
  
  // ツール呼び出し実行
  async executeToolCall(action, input) {
    // ログ出力
    console.log(`ツール '${action}' を実行中...`);
    
    // 実装例: 単純なタイプ別処理
    if (action.startsWith('search_')) {
      return {
        results: [`${action}の検索結果: ${JSON.stringify(input)}`],
        timestamp: new Date().toISOString(),
      };
    } else if (action.startsWith('file_')) {
      return {
        path: typeof input === 'string' ? input : input.path,
        success: true,
        timestamp: new Date().toISOString(),
      };
    } else if (action.startsWith('github_')) {
      return {
        repo: typeof input === 'string' ? input : input.repo,
        success: true,
        files: [
          { name: 'file1.js', size: 1024 },
          { name: 'file2.js', size: 2048 }
        ],
        timestamp: new Date().toISOString(),
      };
    } else {
      // デフォルトの応答
      return {
        action: action,
        input: input,
        timestamp: new Date().toISOString(),
        message: `${action}は実行されましたが、詳細な実装はまだありません。`
      };
    }
  }
  
  // サーバーが実行中かチェック
  isServerRunning(serverId) {
    const pidFile = path.join(this.pidDir, `${serverId}.pid`);
    
    if (!fs.existsSync(pidFile)) {
      return false;
    }
    
    try {
      // PIDファイルからプロセスIDを読み取り
      const pid = fs.readFileSync(pidFile, 'utf8').trim();
      
      // プロセスが存在するか確認
      if (process.platform === 'win32') {
        // Windowsの場合
        try {
          const result = execSync(`tasklist /FI "PID eq ${pid}" /NH`, { encoding: 'utf8' });
          return result.indexOf(pid) !== -1;
        } catch (error) {
          return false;
        }
      } else {
        // Unix/Linuxの場合
        try {
          process.kill(parseInt(pid), 0); // シグナル0はプロセスが存在するかをチェックするだけ
          return true;
        } catch (error) {
          return false;
        }
      }
    } catch (error) {
      return false;
    }
  }
  
  // 実行中のサーバーを取得
  getRunningServers() {
    try {
      if (!fs.existsSync(this.pidDir)) {
        return [];
      }
      
      const files = fs.readdirSync(this.pidDir);
      const runningServers = [];
      
      for (const file of files) {
        if (file.endsWith('.pid')) {
          const serverId = file.replace('.pid', '');
          if (this.isServerRunning(serverId)) {
            runningServers.push(serverId);
          } else {
            // 実行されていないサーバーのPIDファイルは削除
            try {
              fs.unlinkSync(path.join(this.pidDir, file));
            } catch (e) {
              // 削除エラーは無視
            }
          }
        }
      }
      
      return runningServers;
    } catch (error) {
      console.error('実行中サーバー取得エラー:', error.message);
      return [];
    }
  }
  
  // サーバー起動（ID指定）
  async startServerById(serverId) {
    const configs = await this.loadServerConfigs();
    const serverConfig = configs.find(config => config.id === serverId);
    
    if (!serverConfig) {
      throw new Error(`Server with ID ${serverId} not found`);
    }
    
    return this.startServer(serverConfig);
  }
  
  // サーバー起動
  async startServer(serverConfig) {
    return new Promise((resolve, reject) => {
      try {
        // 既に実行中のプロセスがあるか確認
        if (this.isServerRunning(serverConfig.id)) {
          console.log(`サーバー ${serverConfig.id} は既に実行中です`);
          return resolve(serverConfig.id);
        }
        
        console.log(`サーバー ${serverConfig.id} を起動しています...`);
        
        // ログファイルのパスを設定
        const stdoutPath = path.join(this.logDir, `${serverConfig.id}.out.log`);
        const stderrPath = path.join(this.logDir, `${serverConfig.id}.err.log`);
        
        // ログファイルを開く
        const stdout = fs.openSync(stdoutPath, 'a');
        const stderr = fs.openSync(stderrPath, 'a');
        
        // 環境変数を設定
        const env = { ...process.env };
        if (serverConfig.env) {
          Object.assign(env, serverConfig.env);
        }
        
        // コマンドと引数の確認
        const command = serverConfig.command || 'node';
        const args = Array.isArray(serverConfig.args) ? serverConfig.args : [];
        
        // プロセスを起動
        const serverProcess = spawn(command, args, {
          env,
          cwd: serverConfig.cwd || process.cwd(),
          stdio: ['ignore', stdout, stderr],
          detached: true // プロセスをデタッチして親から独立させる
        });
        
        // 親プロセスから切り離す
        serverProcess.unref();
        
        // PIDファイルに保存
        const pidFile = path.join(this.pidDir, `${serverConfig.id}.pid`);
        fs.writeFileSync(pidFile, serverProcess.pid.toString());
        
        // エラーハンドリング
        serverProcess.on('error', (err) => {
          console.error(`サーバー ${serverConfig.id} 起動エラー:`, err.message);
          reject(err);
        });
        
        // 1秒待ってプロセスが生きているか確認
        setTimeout(() => {
          if (this.isServerRunning(serverConfig.id)) {
            console.log(`サーバー ${serverConfig.id} を起動しました (PID: ${serverProcess.pid})`);
            resolve(serverConfig.id);
          } else {
            const error = new Error(`サーバー ${serverConfig.id} の起動に失敗しました`);
            reject(error);
          }
        }, 1000);
      } catch (error) {
        console.error(`サーバー ${serverConfig.id} の起動に失敗:`, error.message);
        reject(error);
      }
    });
  }
  
  // サーバー停止
  async stopServer(serverId) {
    const pidFile = path.join(this.pidDir, `${serverId}.pid`);
    
    if (!fs.existsSync(pidFile)) {
      console.log(`サーバー ${serverId} は既に停止しています`);
      return true;
    }
    
    try {
      // PIDファイルからプロセスIDを読み取り
      const pidStr = fs.readFileSync(pidFile, 'utf8').trim();
      const pid = parseInt(pidStr);
      
      if (isNaN(pid)) {
        console.error(`サーバー ${serverId} のPIDが無効: ${pidStr}`);
        fs.unlinkSync(pidFile);
        return false;
      }
      
      // プロセスを終了
      console.log(`サーバー ${serverId} を停止中 (PID: ${pid})...`);
      
      if (process.platform === 'win32') {
        // Windowsの場合
        try {
          execSync(`taskkill /PID ${pid} /F /T`);
        } catch (error) {
          console.error(`サーバー ${serverId} の停止に失敗:`, error.message);
        }
      } else {
        // Unix/Linuxの場合
        try {
          process.kill(pid, 'SIGTERM');
          
          // 少し待ってからSIGKILLを送信（プロセスがまだ生きていれば）
          setTimeout(() => {
            try {
              process.kill(pid, 0);
              // プロセスがまだ生きている場合、SIGKILLを送信
              process.kill(pid, 'SIGKILL');
            } catch (e) {
              // プロセスが既に終了している場合は何もしない
            }
          }, 2000);
        } catch (error) {
          if (error.code !== 'ESRCH') {
            console.error(`サーバー ${serverId} の停止に失敗:`, error.message);
          }
        }
      }
      
      // PIDファイルを削除
      fs.unlinkSync(pidFile);
      console.log(`サーバー ${serverId} を停止しました`);
      
      return true;
    } catch (error) {
      console.error(`サーバー ${serverId} の停止に失敗:`, error.message);
      
      // エラーがあってもPIDファイルは削除
      try {
        fs.unlinkSync(pidFile);
      } catch (e) {
        // 削除エラーは無視
      }
      
      return false;
    }
  }
  
  // 設定ファイルからサーバー設定を読み込む
  async loadServerConfigs() {
    try {
      if (!fs.existsSync(this.configPath)) {
        console.error(`Config file not found at ${this.configPath}`);
        return [];
      }
      
      const configData = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      
      return Object.entries(configData.mcpServers || {}).map(([id, config]) => ({
        id,
        name: config.name || id,
        command: config.command,
        args: config.args || [],
        env: config.env || {},
        cwd: config.cwd
      }));
    } catch (error) {
      console.error('Error loading server configs:', error);
      return [];
    }
  }
}