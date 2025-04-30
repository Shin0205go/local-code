import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export class DockerSandbox {
  constructor(options = {}) {
    this.image = options.image || 'node:18-alpine';
    this.timeoutSeconds = options.timeoutSeconds || 30;
    this.workingDir = options.workingDir || process.cwd();
    this.tempDir = options.tempDir || path.join(os.tmpdir(), 'ollama-code-sandbox');
    this.networkEnabled = options.networkEnabled || false;
    
    // 一時ディレクトリが存在しない場合は作成
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }
  
  async execute(code, options = {}) {
    // 実行用の一意のIDを生成
    const sandboxId = crypto.randomBytes(8).toString('hex');
    const sandboxDir = path.join(this.tempDir, sandboxId);
    fs.mkdirSync(sandboxDir, { recursive: true });
    
    // コードファイルを作成
    const fileName = options.fileName || 'script.js';
    const codePath = path.join(sandboxDir, fileName);
    fs.writeFileSync(codePath, code);
    
    // ネットワーク設定
    const networkFlag = this.networkEnabled ? '' : '--network none';
    
    // Dockerで実行
    const command = `docker run --rm -i ${networkFlag} -v "${sandboxDir}:/app" -w /app ${this.image} node ${fileName}`;
    
    try {
      console.log('Dockerサンドボックスでコード実行中...');
      const output = execSync(command, {
        timeout: this.timeoutSeconds * 1000,
        encoding: 'utf8'
      });
      
      return {
        success: true,
        output
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        output: error.stdout || '',
        stderr: error.stderr || ''
      };
    } finally {
      // クリーンアップ
      try {
        fs.rmSync(sandboxDir, { recursive: true, force: true });
      } catch (e) {
        console.warn('サンドボックスディレクトリのクリーンアップに失敗:', e.message);
      }
    }
  }
}