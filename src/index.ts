import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import { OllamaProvider } from './providers/ollama';
import { DockerSandbox } from './sandbox/docker';
import { GitHubMCP } from './mcp/github';
import { saveConfig, loadConfig, OllamaCodeConfig } from './config';
import { MCPServerManager } from './mcp/server';
import { ServerConfig } from './mcp/config';

// MCPサーバーマネージャー
let mcpServerManager: MCPServerManager | null = null;

// セットアップウィザード
export async function setupWizard(): Promise<void> {
  console.log('Ollama Code セットアップウィザード');
  console.log('============================');
  
  // Ollamaが実行中か確認
  const provider = new OllamaProvider({});
  
  try {
    console.log('Ollamaサーバーに接続中...');
    const models = await provider.listModels();
    
    if (models.length === 0) {
      console.log('モデルが見つかりません。Ollamaでモデルをダウンロードしてください：');
      console.log('例: ollama pull codellama:7b-instruct');
      return;
    }
    
    console.log(`Ollamaインスタンスで${models.length}個のモデルが見つかりました。`);
    
    const { modelName } = await inquirer.prompt<{ modelName: string }>([
      {
        type: 'list',
        name: 'modelName',
        message: '使用するモデルを選択：',
        choices: models.map(model => model.name)
      }
    ]);
    
    const { sandboxType } = await inquirer.prompt<{ sandboxType: string }>([
      {
        type: 'list',
        name: 'sandboxType',
        message: '優先するサンドボックス環境：',
        choices: [
          { name: 'Docker (推奨)', value: 'docker' },
          { name: 'None (分離なし)', value: 'none' }
        ]
      }
    ]);
    
    // MCPサーバーの使用有無
    const { useMcp } = await inquirer.prompt<{ useMcp: boolean }>([
      {
        type: 'confirm',
        name: 'useMcp',
        message: 'MCPサーバーを使用しますか？',
        default: false
      }
    ]);
    
    // 設定を保存
    const config: OllamaCodeConfig = {
      provider: 'ollama',
      model: modelName,
      baseURL: 'http://localhost:11434/v1',
      sandbox: {
        type: sandboxType,
        options: {}
      },
      mcp: {
        enabled: useMcp
      }
    };
    
    saveConfig(config);
    console.log('設定が正常に保存されました！');
    
    // MCPサーバーのセットアップ
    if (useMcp) {
      await setupMcpServers();
    }
    
  } catch (error) {
    console.error('Ollamaサーバーへの接続エラー:', error instanceof Error ? error.message : String(error));
    console.log('Ollamaが実行中であることを確認して、もう一度お試しください。');
  }
}

// MCPサーバーのセットアップ
async function setupMcpServers(): Promise<void> {
  console.log('\nMCPサーバーのセットアップ');
  console.log('=====================');
  
  try {
    // MCPサーバーマネージャーの初期化
    mcpServerManager = new MCPServerManager();
    
    // 設定ファイルを読み込む
    const serverConfigs = await mcpServerManager.loadServerConfigs();
    
    if (serverConfigs.length === 0) {
      console.log('利用可能なMCPサーバーがありません。設定ファイルを確認してください。');
      console.log('設定ファイルパス: ' + path.join(process.cwd(), 'config/mcp-config.json'));
      return;
    }
    
    // 起動するサーバーを選択
    const { selectedServers } = await inquirer.prompt<{ selectedServers: string[] }>([
      {
        type: 'checkbox',
        name: 'selectedServers',
        message: '起動するMCPサーバーを選択:',
        choices: serverConfigs.map(server => ({
          name: `${server.name} (${server.id})`,
          value: server.id,
          checked: true
        }))
      }
    ]);
    
    if (selectedServers.length === 0) {
      console.log('MCPサーバーが選択されていません。');
      return;
    }
    
    // 選択されたサーバーを起動
    console.log('選択されたMCPサーバーを起動中...');
    
    const startedServers: string[] = [];
    for (const serverId of selectedServers) {
      const serverConfig = serverConfigs.find(s => s.id === serverId);
      if (serverConfig) {
        try {
          console.log(`${serverConfig.name} (${serverId}) を起動中...`);
          await mcpServerManager.startServer(serverConfig);
          startedServers.push(serverId);
          console.log(`${serverConfig.name} (${serverId}) を起動しました`);
        } catch (error) {
          console.error(`${serverConfig.name} (${serverId}) の起動に失敗しました:`, error instanceof Error ? error.message : String(error));
        }
      }
    }
    
    if (startedServers.length > 0) {
      console.log(`${startedServers.length}個のMCPサーバーを起動しました`);
    } else {
      console.log('MCPサーバーを起動できませんでした');
    }
  } catch (error) {
    console.error('MCPサーバーセットアップエラー:', error instanceof Error ? error.message : String(error));
  }
}

// コード解析
export async function analyzeCode(config: OllamaCodeConfig, directory: string): Promise<void> {
  console.log(`ディレクトリを解析中: ${directory}`);
  
  // プロバイダーを作成
  const provider = new OllamaProvider(config);
  
  // 関連ファイルを取得
  const files = await getRelevantFiles(directory);
  console.log(`関連ファイルが${files.length}個見つかりました。`);
  
  // ファイル内容を読み込む（最大10ファイル、合計30KB）
  const fileContents: { path: string; content: string }[] = [];
  let totalSize = 0;
  const maxSize = 30 * 1024; // 30KB
  
  for (let i = 0; i < Math.min(files.length, 10); i++) {
    const filePath = files[i];
    const content = fs.readFileSync(filePath, 'utf8');
    
    totalSize += content.length;
    if (totalSize > maxSize) {
      console.log(`サイズ制限に達しました。${i}個のファイルを解析します。`);
      break;
    }
    
    fileContents.push({
      path: filePath,
      content: content.length > 2000 ? content.substring(0, 2000) + '...' : content
    });
  }
  
  // モデル用のメッセージを作成
  const messages = [
    {
      role: 'system',
      content: 'あなたはコードベースを解析し、明確かつ簡潔に説明するエキスパートプログラマーです。構造、パターン、主要コンポーネントを特定し、必要に応じて改善提案も行ってください。'
    },
    {
      role: 'user',
      content: `以下のコードベースを解析してください:\n\n${
        fileContents.map(f => `FILE: ${f.path}\n\n${f.content}`).join('\n\n')
      }`
    }
  ];
  
  // モデルに送信
  console.log('モデルにコードの解析を依頼中...');
  const response = await provider.chatCompletion(messages);
  
  console.log('\n=== 解析結果 ===\n');
  console.log(response.choices[0].message.content);
}

// タスク実行
export async function executeTask(config: OllamaCodeConfig, task: string): Promise<void> {
  console.log(`タスクを実行中: ${task}`);
  
  // プロバイダーを作成
  const provider = new OllamaProvider(config);
  
  // サンドボックスを作成（必要な場合）
  let sandbox: DockerSandbox | null = null;
  if (config.sandbox && typeof config.sandbox !== 'string' && config.sandbox.type !== 'none') {
    sandbox = new DockerSandbox();
    console.log(`${config.sandbox.type}サンドボックスを使用してコードを実行します。`);
  }
  
  // MCPサーバーを初期化（必要な場合）
  let mcpContext = '';
  if (config.mcp && config.mcp.enabled) {
    console.log('MCPサーバー情報を取得中...');
    
    // MCPサーバーマネージャーの初期化
    if (!mcpServerManager) {
      mcpServerManager = new MCPServerManager();
      
      // MCPサーバーを自動起動
      try {
        await initializeMcpServers();
        
        // 起動中のMCPサーバー情報を取得
        const runningServers = mcpServerManager.getRunningServers();
        if (runningServers.length > 0) {
          mcpContext = `使用可能なMCPサーバー: ${runningServers.join(', ')}\n\n`;
        }
      } catch (error) {
        console.warn('MCPサーバー初期化エラー:', error instanceof Error ? error.message : String(error));
      }
    }
  }
  
  // GitHubリポジトリがある場合
  let repoContext = '';
  if (config.github) {
    console.log(`GitHubリポジトリを分析中: ${config.github}`);
    const mcp = new GitHubMCP();
    try {
      const repoDir = await mcp.cloneRepo(config.github);
      repoContext = `GitHubリポジトリ: ${config.github}\nクローン先: ${repoDir}\n\n`;
    } catch (error) {
      console.warn('GitHubリポジトリの分析中にエラー:', error instanceof Error ? error.message : String(error));
    }
  }
  
  // 現在のディレクトリ情報
  const currentDir = process.cwd();
  const dirInfo = fs.readdirSync(currentDir).slice(0, 20).join(', ');
  
  // メッセージを作成
  const messages = [
    {
      role: 'system',
      content: 'あなたはコーディングタスクの実装を支援するエキスパートプログラマーです。タスクを解決するJavaScriptコードを生成してください。コードの動作を説明し、完全で実行可能なコードを書いてください。'
    },
    {
      role: 'user',
      content: `${mcpContext}${repoContext}現在のディレクトリ: ${currentDir}\nファイル: ${dirInfo}\n\nタスク: ${task}`
    }
  ];
  
  // モデルに送信
  console.log('コード生成中...');
  const response = await provider.chatCompletion(messages);
  const content = response.choices[0].message.content;
  
  console.log('\n=== 生成されたソリューション ===\n');
  console.log(content);
  
  // コードブロックを抽出
  const codeBlocks = extractCodeBlocks(content);
  
  if (codeBlocks.length > 0 && sandbox) {
    const { execute } = await inquirer.prompt<{ execute: boolean }>([
      {
        type: 'confirm',
        name: 'execute',
        message: 'このコードをサンドボックスで実行しますか？',
        default: true
      }
    ]);
    
    if (execute) {
      console.log('\n=== コード実行中 ===\n');
      const result = await sandbox.execute(codeBlocks[0]);
      
      console.log('\n=== 実行結果 ===\n');
      if (result.success) {
        console.log(result.output);
        
        // 保存するか尋ねる
        const { save } = await inquirer.prompt<{ save: boolean }>([
          {
            type: 'confirm',
            name: 'save',
            message: 'このコードをファイルに保存しますか？',
            default: true
          }
        ]);
        
        if (save) {
          const { filename } = await inquirer.prompt<{ filename: string }>([
            {
              type: 'input',
              name: 'filename',
              message: 'ファイル名:',
              default: 'output.js'
            }
          ]);
          
          fs.writeFileSync(filename, codeBlocks[0]);
          console.log(`コードを${filename}に保存しました`);
        }
      } else {
        console.error('実行に失敗:', result.error);
        if (result.stderr) {
          console.error(result.stderr);
        }
      }
    }
  }
}

// MCPサーバー初期化
async function initializeMcpServers(): Promise<string[]> {
  try {
    // MCPサーバーマネージャーを初期化
    if (!mcpServerManager) {
      mcpServerManager = new MCPServerManager();
    }
    
    // 設定ファイルからサーバー設定を読み込む
    const serverConfigs = await mcpServerManager.loadServerConfigs();
    
    if (serverConfigs.length === 0) {
      console.log('MCPサーバー設定が見つかりません。');
      return [];
    }
    
    // 各サーバーを起動
    console.log(`${serverConfigs.length}個のMCPサーバーを起動中...`);
    
    interface StartResult {
      id: string;
      success: boolean;
      error?: any;
    }
    
    const startPromises = serverConfigs.map(async (config: ServerConfig) => {
      try {
        // すでに実行中なら何もしない
        if (mcpServerManager?.isServerRunning(config.id)) {
          return { id: config.id, success: true };
        }
        
        console.log(`サーバー起動: ${config.name} (${config.id})`);
        await mcpServerManager?.startServer(config);
        return { id: config.id, success: true };
      } catch (error) {
        console.error(`サーバー起動エラー ${config.id}:`, error instanceof Error ? error.message : String(error));
        return { id: config.id, success: false, error };
      }
    });
    
    const results = await Promise.all(startPromises);
    const successful = results.filter(r => r.success).map(r => r.id);
    
    console.log(`MCPサーバー初期化完了: ${successful.length}/${serverConfigs.length}個のサーバーが起動しました`);
    return successful;
  } catch (error) {
    console.error('MCPサーバー初期化エラー:', error instanceof Error ? error.message : String(error));
    return [];
  }
}

// マークダウンからコードブロックを抽出
function extractCodeBlocks(text: string): string[] {
  const codeBlockRegex = /```(?:javascript|js)?\n([\s\S]*?)```/g;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  
  while ((match = codeBlockRegex.exec(text)) !== null) {
    blocks.push(match[1]);
  }
  
  return blocks;
}

// 関連コードファイルを取得
async function getRelevantFiles(directory: string, options: { maxDepth?: number; ignoreDirs?: string[]; extensions?: string[] } = {}): Promise<string[]> {
  const maxDepth = options.maxDepth || 3;
  const ignoreDirs = options.ignoreDirs || ['node_modules', '.git', 'dist', 'build', '.cache'];
  const extensions = options.extensions || ['.js', '.ts', '.jsx', '.tsx', '.json', '.md'];
  
  function walkDir(dir: string, depth = 0): string[] {
    if (depth > maxDepth) return [];
    
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        if (!ignoreDirs.includes(entry.name)) {
          files.push(...walkDir(fullPath, depth + 1));
        }
      } else if (extensions.includes(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
    
    return files;
  }
  
  return walkDir(directory);
}

// MCPコマンドの実行
export async function executeMcpCommand(serverId: string, command: string): Promise<void> {
  try {
    // MCPサーバーマネージャーの初期化
    if (!mcpServerManager) {
      mcpServerManager = new MCPServerManager();
      await initializeMcpServers();
    }
    
    // サーバーが実行中か確認
    if (!mcpServerManager.isServerRunning(serverId)) {
      console.error(`MCPサーバー "${serverId}" は実行されていません。`);
      console.log('利用可能なサーバー:', mcpServerManager.getRunningServers().join(', '));
      return;
    }
    
    console.log(`サーバー ${serverId} にコマンド実行: ${command}`);
    
    // ここでMCPサーバーにコマンドを送信する処理を実装
    // 現在のところ、MCPの実装はモックのみ
    
    console.log('MCPコマンド実行完了');
  } catch (error) {
    console.error('MCPコマンド実行エラー:', error instanceof Error ? error.message : String(error));
  }
}