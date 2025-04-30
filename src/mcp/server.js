import { spawn, execSync, exec } from 'child_process';
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
    
    // PID保存ディレクトリの作成
    if (!fs.existsSync(this.pidDir)) {
      fs.mkdirSync(this.pidDir, { recursive: true });
    }
  }
  
  // IDでサーバーを起動（追加メソッド）
  async startServerById(serverId) {
    const configs = await this.loadServerConfigs();
    const serverConfig = configs.find(config => config.id === serverId);
    
    if (!serverConfig) {
      throw new Error(`Server with ID ${serverId} not found`);
    }
    
    return this.startServer(serverConfig);
  }
  
  // サーバーが実行中かチェック
  isServerRunning(serverId) {
    const pidFile = this.getPidFilePath(serverId);
    
    if (!fs.existsSync(pidFile)) {
      return false;
    }
    
    try {
      // 設定を読み込み
      const configs = this.loadServerConfigsSync();
      const serverConfig = configs.find(config => config.id === serverId);
      
      if (!serverConfig) {
        return false;
      }
      
      // Dockerコマンドの場合
      if (serverConfig.command && serverConfig.command.toLowerCase().includes('docker')) {
        const containerId = fs.readFileSync(pidFile, 'utf8').trim();
        return this.isDockerContainerRunning(serverId, containerId);
      } else {
        // 通常プロセスの場合
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
        return this.isProcessRunning(pid);
      }
    } catch (error) {
      console.error(`Error checking if server ${serverId} is running:`, error.message);
      return false;
    }
  }
  
  // 設定を同期的に読み込む
  loadServerConfigsSync() {
    try {
      if (!fs.existsSync(this.configPath)) {
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
      console.error('Error loading server configs:', error.message);
      return [];
    }
  }
  
  // 実行中のサーバーIDリストを取得
  getRunningServers() {
    try {
      // PIDディレクトリが存在しない場合は空配列を返す
      if (!fs.existsSync(this.pidDir)) {
        return [];
      }
      
      // PIDディレクトリ内のファイルを取得
      const files = fs.readdirSync(this.pidDir);
      
      // 実行中のサーバーIDを収集
      const runningServers = [];
      for (const file of files) {
        if (file.endsWith('.pid')) {
          const serverId = file.replace('.pid', '');
          if (this.isServerRunning(serverId)) {
            runningServers.push(serverId);
          } else {
            // 実行されていないサーバーのPIDファイルは削除
            try {
              fs.unlinkSync(this.getPidFilePath(serverId));
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
  
  // PIDファイルのパスを取得
  getPidFilePath(serverId) {
    return path.join(this.pidDir, `${serverId}.pid`);
  }
  
  // サーバー起動
  async startServer(serverConfig) {
    return new Promise((resolve, reject) => {
      try {
        console.log(`Starting MCP Server: ${serverConfig.name || serverConfig.id}`);
        
        // ログディレクトリの作成
        const logDir = path.join(os.homedir(), '.ollama-code', 'logs');
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }
        
        const stdoutPath = path.join(logDir, `${serverConfig.id}.out.log`);
        const stderrPath = path.join(logDir, `${serverConfig.id}.err.log`);
        
        // サーバーコマンドがdockerで始まる場合は特別な処理
        if (serverConfig.command && serverConfig.command.toLowerCase() === 'docker') {
          // コンテナに名前を付ける
          const containerName = `ollama-code-${serverConfig.id}`;
          
          // 既存のコンテナを削除（既に存在する場合）
          try {
            execSync(`docker rm -f ${containerName} 2>/dev/null || true`);
          } catch (error) {
            // 既存コンテナがない場合は無視
          }
          
          // Docker実行コマンドを作成
          let dockerArgs = Array.isArray(serverConfig.args) ? serverConfig.args.join(' ') : (serverConfig.args || '');
          
          // 環境変数を追加
          const envVars = Object.entries(serverConfig.env || {})
            .map(([key, value]) => `-e ${key}=${value}`)
            .join(' ');
          
          // --nameフラグを追加
          let fullCommand = `docker run --name ${containerName}`;
          
          // 環境変数を追加
          if (envVars) {
            fullCommand += ` ${envVars}`;
          }
          
          // Docker用引数を維持する（-iなど）
          fullCommand += ` ${dockerArgs}`;
          
          console.log(`Executing Docker command: ${fullCommand}`);
          
          // コンテナを起動（ログファイルにリダイレクト）
          // 注意: -iを維持する場合は、バックグラウンド実行時にエラーになるのでstdioを設定
          const dockerProcess = spawn('/bin/sh', ['-c', `${fullCommand} > ${stdoutPath} 2> ${stderrPath}`], {
            detached: true
          });
          
          dockerProcess.unref();
          
          // PIDファイルにプロセスIDを保存
          fs.writeFileSync(this.getPidFilePath(serverConfig.id), dockerProcess.pid.toString());
          
          console.log(`Started Docker process for ${serverConfig.name || serverConfig.id} with PID: ${dockerProcess.pid}`);
          
          // Docker起動プロセス自体はすぐに終了するので、ここでは成功とみなす
          setTimeout(() => {
            try {
              // コンテナIDを取得して更新
              const containerId = execSync(`docker ps -q -f "name=${containerName}"`, { encoding: 'utf8' }).trim();
              if (containerId) {
                // PIDファイルを更新
                fs.writeFileSync(this.getPidFilePath(serverConfig.id), containerId);
                console.log(`Updated container ID for ${serverConfig.id}: ${containerId}`);
              }
            } catch (error) {
              console.warn(`Warning: Could not update container ID: ${error.message}`);
            }
            
            resolve(dockerProcess.pid);
          }, 2000);
        } else {
          // 通常のプロセス起動（Node.jsなど）
          // stdout/stderrをファイルにリダイレクト
          const stdout = fs.openSync(stdoutPath, 'a');
          const stderr = fs.openSync(stderrPath, 'a');
          
          // コマンドと引数を正規化
          const command = serverConfig.command;
          const args = Array.isArray(serverConfig.args) ? serverConfig.args : 
            (typeof serverConfig.args === 'string' ? serverConfig.args.split(' ').filter(Boolean) : []);
          
          console.log(`Executing command: ${command} ${args.join(' ')}`);
          
          // プロセス起動
          const mcpServer = spawn(command, args, {
            env: { ...process.env, ...serverConfig.env },
            cwd: serverConfig.cwd || process.cwd(),
            stdio: ['ignore', stdout, stderr],
            detached: true  // プロセスを親から切り離す
          });
          
          // プロセスを親から切り離す
          mcpServer.unref();
          
          // エラーハンドリング
          mcpServer.on('error', (err) => {
            console.error(`Failed to start process: ${err.message}`);
            reject(err);
          });
          
          // PIDを保存
          fs.writeFileSync(this.getPidFilePath(serverConfig.id), mcpServer.pid.toString());
          
          console.log(`Started ${serverConfig.name || serverConfig.id} with PID: ${mcpServer.pid}`);
          
          // 少し待ってから成功を返す
          setTimeout(() => {
            if (this.isProcessRunning(mcpServer.pid)) {
              resolve(mcpServer.pid);
            } else {
              reject(new Error(`Process started but terminated immediately. Check logs at ${stderrPath}`));
            }
          }, 1000);
        }
      } catch (error) {
        console.error(`Error starting MCP server ${serverConfig.id}:`, error.message);
        reject(error);
      }
    });
  }
  
  // Docker用のプロセス実行チェック
  isDockerContainerRunning(serverId, containerIdOrName) {
    try {
      const containerName = `ollama-code-${serverId}`;
      // docker psコマンドでコンテナ状態を確認（IDまたは名前で）
      const cmd = `docker ps -q -f "name=${containerName}"`;
      
      console.log(`Checking Docker container status with: ${cmd}`);
      
      const result = execSync(cmd, { encoding: 'utf8' }).trim();
      console.log(`Docker container check result: "${result}"`);
      
      return result !== '';
    } catch (error) {
      console.error(`Error checking Docker container: ${error.message}`);
      return false;
    }
  }
  
  // サーバー停止
  async stopServer(serverId) {
    const pidFile = this.getPidFilePath(serverId);
    
    if (!fs.existsSync(pidFile)) {
      console.log(`No PID file found for server ${serverId}`);
      return false;
    }
    
    try {
      const pidOrContainerId = fs.readFileSync(pidFile, 'utf8').trim();
      
      // サーバー設定を取得してコマンドを確認
      const configs = await this.loadServerConfigs();
      const serverConfig = configs.find(config => config.id === serverId);
      
      if (serverConfig && serverConfig.command && serverConfig.command.toLowerCase() === 'docker') {
        // Dockerコンテナを停止
        const containerName = `ollama-code-${serverId}`;
        console.log(`Stopping Docker container: ${containerName}`);
        
        try {
          execSync(`docker stop ${containerName} 2>/dev/null || docker stop ${pidOrContainerId} 2>/dev/null || docker rm -f ${containerName} 2>/dev/null || docker rm -f ${pidOrContainerId} 2>/dev/null || true`);
          console.log(`Stopped Docker container for server ${serverId}`);
        } catch (error) {
          console.warn(`Warning while stopping Docker container: ${error.message}`);
        }
        
        // PIDファイル削除
        fs.unlinkSync(pidFile);
        return true;
      } else {
        // 通常プロセスを停止
        const numericPid = parseInt(pidOrContainerId);
        
        // プロセスが実行中か確認
        if (this.isProcessRunning(numericPid)) {
          // OSに応じたプロセス終了コマンド
          if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', numericPid.toString(), '/f', '/t']);
          } else {
            process.kill(numericPid, 'SIGTERM');
          }
          
          console.log(`Stopped server ${serverId} (PID: ${numericPid})`);
        } else {
          console.log(`Process for server ${serverId} (PID: ${numericPid}) is not running`);
        }
        
        // PIDファイル削除
        fs.unlinkSync(pidFile);
        return true;
      }
    } catch (error) {
      console.error(`Error stopping server ${serverId}:`, error.message);
      return false;
    }
  }
  
  // サーバーの状態をチェック
  async getServerStatus(serverId) {
    const pidFile = this.getPidFilePath(serverId);
    
    if (!fs.existsSync(pidFile)) {
      return 'stopped';
    }
    
    try {
      const configs = await this.loadServerConfigs();
      const serverConfig = configs.find(config => config.id === serverId);
      
      if (serverConfig && serverConfig.command && serverConfig.command.toLowerCase() === 'docker') {
        // Dockerコンテナの場合
        return this.isDockerContainerRunning(serverId) ? 'running' : 'stopped';
      } else {
        // 通常プロセスの場合
        const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
        return this.isProcessRunning(pid) ? 'running' : 'stopped';
      }
    } catch (error) {
      console.error(`Error getting server status for ${serverId}:`, error.message);
      return 'unknown';
    }
  }
  
  // プロセスが実行中かチェック
  isProcessRunning(pid) {
    try {
      // 0シグナルを送信して生存確認
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }
  
  // 全サーバーの状態を取得
  async getAllServerStatus() {
    const configs = await this.loadServerConfigs();
    
    const statusPromises = configs.map(async (config) => {
      const status = await this.getServerStatus(config.id);
      return {
        ...config,
        status
      };
    });
    
    return Promise.all(statusPromises);
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