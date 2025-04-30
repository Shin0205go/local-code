import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

export class GitHubMCP {
  constructor(options = {}) {
    this.githubToken = options.githubToken;
    this.tempDir = options.tempDir || path.join(os.tmpdir(), 'ollama-code-github');
    this.debug = options.debug || true; // デバッグログを有効化
    
    // 一時ディレクトリが存在しない場合は作成
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    if (this.debug) {
      console.log(`GitHubMCPクライアント初期化: 一時ディレクトリ=${this.tempDir}`);
    }
  }
  
  /**
   * リポジトリURLからオーナー名とリポジトリ名を抽出
   * @param repoUrl リポジトリURL
   * @returns {Object} オーナー名とリポジトリ名
   */
  parseRepoUrl(repoUrl) {
    if (this.debug) {
      console.log(`GitHubリポジトリURL解析中: ${repoUrl}`);
    }
    
    const gitHubUrlPattern = /github\.com\/([^\/]+)\/([^\/\.]+)/;
    const match = repoUrl.match(gitHubUrlPattern);
    
    if (!match) {
      const error = `不正なGitHubリポジトリURL: ${repoUrl}`;
      if (this.debug) console.error(error);
      throw new Error(error);
    }
    
    const result = {
      owner: match[1],
      repo: match[2]
    };
    
    if (this.debug) {
      console.log(`リポジトリ情報抽出: ${JSON.stringify(result)}`);
    }
    
    return result;
  }
  
  /**
   * リポジトリをクローン
   * @param repoUrl リポジトリURL
   * @param options オプション
   * @returns {string} クローン先のディレクトリパス
   */
  async cloneRepo(repoUrl, options = {}) {
    const repoId = Date.now().toString();
    const cloneDir = path.join(this.tempDir, repoId);
    
    console.log(`=== GitHubリポジトリクローン開始 ===`);
    console.log(`リポジトリURL: ${repoUrl}`);
    console.log(`クローン先: ${cloneDir}`);
    console.log(`オプション: ${JSON.stringify(options)}`);
    
    try {
      // cloneDirを作成
      fs.mkdirSync(cloneDir, { recursive: true });
      
      // リポジトリをクローン（デフォルトでは--depth 1を使用）
      const gitCommand = `git clone ${options.depth === undefined ? '--depth 1' : ''} ${repoUrl} ${cloneDir}`;
      console.log(`実行コマンド: ${gitCommand}`);
      
      const startTime = Date.now();
      execSync(gitCommand, {
        stdio: options.stdio || (this.debug ? 'inherit' : 'ignore')
      });
      const endTime = Date.now();
      
      // クローン後の情報出力
      console.log(`クローン完了 (所要時間: ${(endTime - startTime) / 1000}秒)`);
      
      // リポジトリ情報を取得
      const fileCount = this.countFiles(cloneDir);
      console.log(`リポジトリ内のファイル数: ${fileCount}`);
      
      // 主要ディレクトリを表示
      const topDirs = fs.readdirSync(cloneDir)
        .filter(f => fs.statSync(path.join(cloneDir, f)).isDirectory())
        .filter(d => !d.startsWith('.'));
      
      console.log(`主要ディレクトリ: ${topDirs.join(', ')}`);
      
      return cloneDir;
    } catch (error) {
      console.error(`リポジトリクローンエラー:`, error.message);
      
      if (error.stderr) {
        console.error(`Gitエラー出力:`, error.stderr.toString());
      }
      
      throw new Error(`リポジトリのクローンに失敗: ${error.message}`);
    }
  }
  
  /**
   * ディレクトリ内のファイル数をカウント
   * @param dir ディレクトリパス
   * @returns {number} ファイル数
   */
  countFiles(dir) {
    try {
      // findコマンドを使用してファイル数をカウント（.gitディレクトリは除外）
      const result = execSync(
        `find ${dir} -type f -not -path "*/\\.git/*" | wc -l`,
        { encoding: 'utf8' }
      );
      return parseInt(result.trim(), 10);
    } catch (error) {
      console.error('ファイル数カウントエラー:', error.message);
      return -1;
    }
  }
  
  /**
   * MCPサーバーを使用してGitHubデータを取得
   * @param serverId MCPサーバーID
   * @param action アクション
   * @param params パラメータ
   */
  async requestMcpServer(serverId, action, params = {}) {
    console.log(`=== MCP GitHub API リクエスト ===`);
    console.log(`サーバーID: ${serverId}`);
    console.log(`アクション: ${action}`);
    console.log(`パラメータ: ${JSON.stringify(params, null, 2)}`);
    
    try {
      // ここにMCPサーバーとの実際の通信処理を実装
      // 現在はデバッグ情報表示のみ
      
      // 仮のレスポンス
      const response = {
        success: true,
        action: action,
        params: params,
        result: `GitHubリポジトリ情報の取得が完了しました (アクション: ${action})`,
        timestamp: new Date().toISOString()
      };
      
      console.log(`MCP応答: ${JSON.stringify(response, null, 2)}`);
      
      return response;
    } catch (error) {
      console.error(`MCP GitHub APIリクエストエラー:`, error.message);
      
      return {
        success: false,
        error: error.message,
        action: action,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * リポジトリの特定ディレクトリのファイル一覧を取得
   * @param repoDir リポジトリディレクトリ
   * @param subDir サブディレクトリパス（省略可）
   * @returns {Object} ファイル情報
   */
  getDirectoryContents(repoDir, subDir = '') {
    console.log(`リポジトリディレクトリ内容取得: ${repoDir}, サブディレクトリ: ${subDir || '(ルート)'}`);
    
    try {
      const targetDir = subDir ? path.join(repoDir, subDir) : repoDir;
      
      if (!fs.existsSync(targetDir)) {
        throw new Error(`ディレクトリが存在しません: ${targetDir}`);
      }
      
      const entries = fs.readdirSync(targetDir, { withFileTypes: true });
      
      const files = entries
        .filter(entry => entry.isFile() && !entry.name.startsWith('.'))
        .map(entry => ({
          name: entry.name,
          path: path.join(subDir, entry.name),
          size: fs.statSync(path.join(targetDir, entry.name)).size
        }));
        
      const directories = entries
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => ({
          name: entry.name,
          path: path.join(subDir, entry.name)
        }));
      
      console.log(`ディレクトリ一覧取得完了: ファイル=${files.length}個, ディレクトリ=${directories.length}個`);
      
      return {
        files,
        directories,
        path: subDir || '/',
        fullPath: targetDir
      };
    } catch (error) {
      console.error(`ディレクトリ内容取得エラー:`, error.message);
      throw error;
    }
  }
  
  /**
   * リポジトリ内のファイル内容を取得
   * @param repoDir リポジトリディレクトリ
   * @param filePath 対象ファイルのパス
   * @returns {Object} ファイル情報と内容
   */
  getFileContent(repoDir, filePath) {
    console.log(`ファイル内容取得: ${repoDir}, ファイル: ${filePath}`);
    
    try {
      const fullPath = path.join(repoDir, filePath);
      
      if (!fs.existsSync(fullPath)) {
        throw new Error(`ファイルが存在しません: ${fullPath}`);
      }
      
      if (!fs.statSync(fullPath).isFile()) {
        throw new Error(`指定されたパスはファイルではありません: ${fullPath}`);
      }
      
      // ファイル内容と情報を取得
      const content = fs.readFileSync(fullPath, 'utf8');
      const stats = fs.statSync(fullPath);
      
      console.log(`ファイル内容取得完了: サイズ=${stats.size}バイト`);
      
      return {
        path: filePath,
        fullPath,
        name: path.basename(filePath),
        size: stats.size,
        content,
        extension: path.extname(filePath),
        lastModified: stats.mtime
      };
    } catch (error) {
      console.error(`ファイル内容取得エラー:`, error.message);
      throw error;
    }
  }
  
  /**
   * リポジトリ内のREADMEファイルを検索して内容を取得
   * @param repoDir リポジトリディレクトリ 
   * @returns {Object|null} READMEの情報と内容、見つからない場合はnull
   */
  findReadmeFile(repoDir) {
    console.log(`READMEファイル検索中: ${repoDir}`);
    
    try {
      // 一般的なREADMEファイル名パターン
      const readmePatterns = [
        'README.md',
        'Readme.md',
        'readme.md',
        'README.markdown',
        'README',
        'README.txt'
      ];
      
      // 各パターンで検索
      for (const pattern of readmePatterns) {
        const readmePath = path.join(repoDir, pattern);
        
        if (fs.existsSync(readmePath) && fs.statSync(readmePath).isFile()) {
          console.log(`READMEファイルが見つかりました: ${pattern}`);
          return this.getFileContent(repoDir, pattern);
        }
      }
      
      console.log('READMEファイルが見つかりませんでした');
      return null;
    } catch (error) {
      console.error(`READMEファイル検索エラー:`, error.message);
      return null;
    }
  }
  
  /**
   * リポジトリ情報のサマリーを取得
   * @param repoDir リポジトリディレクトリ
   * @returns {Object} リポジトリ情報
   */
  async getRepositorySummary(repoDir) {
    console.log(`リポジトリ情報取得: ${repoDir}`);
    
    try {
      // リポジトリのメタデータ取得
      const gitOrigin = execSync(`cd ${repoDir} && git config --get remote.origin.url`, { encoding: 'utf8' }).trim();
      const gitBranch = execSync(`cd ${repoDir} && git rev-parse --abbrev-ref HEAD`, { encoding: 'utf8' }).trim();
      const lastCommit = execSync(`cd ${repoDir} && git log -1 --pretty=format:"%h - %an, %ar : %s"`, { encoding: 'utf8' }).trim();
      
      // ファイル情報取得
      const fileCount = this.countFiles(repoDir);
      
      // ディレクトリ内容取得
      const rootContent = this.getDirectoryContents(repoDir);
      
      // READMEファイル取得
      const readme = this.findReadmeFile(repoDir);
      
      // ソースディレクトリ特定
      const srcDir = rootContent.directories.find(dir => 
        ['src', 'lib', 'source', 'app'].includes(dir.name.toLowerCase())
      );
      
      // srcディレクトリが存在する場合、その内容も取得
      let srcContent = null;
      if (srcDir) {
        srcContent = this.getDirectoryContents(repoDir, srcDir.path);
      }
      
      // リポジトリサマリー作成
      const summary = {
        repository: {
          origin: gitOrigin,
          branch: gitBranch,
          lastCommit,
          fileCount
        },
        rootContent: {
          files: rootContent.files.slice(0, 10), // 最初の10ファイルのみ
          directories: rootContent.directories
        },
        readme: readme ? {
          path: readme.path,
          content: readme.content.length > 1000 ? 
                   readme.content.substring(0, 1000) + '...' : 
                   readme.content
        } : null,
        sourceDirectory: srcDir ? {
          path: srcDir.path,
          files: srcContent.files.slice(0, 10),
          directories: srcContent.directories
        } : null
      };
      
      console.log(`リポジトリ情報取得完了: ファイル数=${fileCount}, ディレクトリ数=${rootContent.directories.length}`);
      
      return summary;
    } catch (error) {
      console.error(`リポジトリ情報取得エラー:`, error.message);
      
      // 最低限の情報は返す
      return {
        error: error.message,
        repository: {
          fileCount: this.countFiles(repoDir)
        },
        rootContent: {
          files: [],
          directories: []
        }
      };
    }
  }
}
