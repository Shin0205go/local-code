import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import { OllamaProvider } from './providers/ollama.js';
import { DockerSandbox } from './sandbox/docker.js';
import { saveConfig, loadConfig, OllamaCodeConfig } from './config.js';
import { MCPServerManager } from './mcp/server.js';
import { ServerConfig } from './mcp/config.js';
import { OllamaMCPBridge } from './mcp/ollama-bridge.js';
import chalk from 'chalk';
// 必要なモジュールをインポート
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { EmptyResultSchema } from "@modelcontextprotocol/sdk/types.js";
// 自作モジュールからの関数インポート
import { getAllTools, callTool } from './mcp/client.js';

// MCPサーバーマネージャー
let mcpServerManager: MCPServerManager | null = null;
// OllamaMCPブリッジ
let ollamaMCPBridge: OllamaMCPBridge | null = null;
// MCP SDKクライアントを格納するマップ
let sdkMcpClients: Map<string, Client> = new Map();

// 対話式チャット - メイン実装
export async function startChat(config: OllamaCodeConfig): Promise<void> {
  console.log(chalk.blue('Ollama Code 対話モード'));
  console.log(chalk.gray('-----------------------------------'));
  console.log('終了するには "exit" または "quit" と入力してください。');
  
  // 設定がなければ、デフォルト設定を使用
  if (!config || !config.model) {
    console.log(chalk.yellow('警告: 設定ファイルが見つからないか不完全です。デフォルト設定を使用します。'));
    console.log(chalk.yellow('セットアップを実行するには: ollama-code setup'));
    
    // デフォルト設定
    config = {
      provider: 'ollama',
      model: 'codellama:7b-instruct',
      baseURL: 'http://localhost:11434/v1',
      sandbox: { type: 'none', options: {} }
    };
  }
  
  // プロバイダーを作成
  const provider = new OllamaProvider(config);
  
  // Ollamaサーバーに接続できるか確認
  try {
    console.log(chalk.gray('Ollamaサーバーに接続しています...'));
    const models = await provider.listModels();
    if (models.length === 0) {
      console.error(chalk.red('エラー: Ollamaサーバーに接続できましたが、利用可能なモデルがありません。'));
      console.log('Ollamaでモデルをダウンロードしてください。例: ollama pull codellama:7b-instruct');
      return;
    }
    console.log(chalk.green(`Ollamaサーバーに接続しました。モデル: ${config.model}`));
  } catch (error) {
    console.error(chalk.red('エラー: Ollamaサーバーに接続できません。'));
    console.log('Ollamaサーバーが実行中であることを確認して、もう一度お試しください。');
    console.log('インストール方法: https://ollama.ai/download');
    return;
  }
  
  // MCPサーバーの初期化を試みる（失敗してもエラーにはしない）
  let mcpEnabled = false;
  let mcpServers: string[] = [];
  
  if (config.mcp && config.mcp.enabled) {
    try {
      console.log(chalk.gray('MCPサーバーの初期化を試みています...'));
      mcpServerManager = new MCPServerManager();
      
      // MCPサーバーを自動起動
      mcpServers = await initializeMcpServers();
      
      if (mcpServers.length > 0) {
        mcpEnabled = true;
        console.log(chalk.green(`${mcpServers.length}個のMCPサーバーを起動しました。高度なツール機能が利用可能です。`));
      } else {
        console.log(chalk.yellow('MCPサーバーを起動できませんでした。基本的な対話モードで続行します。'));
      }
    } catch (error) {
      console.log(chalk.yellow('MCPサーバーの初期化に失敗しました。基本的な対話モードで続行します。'));
    }
  } else {
    console.log(chalk.gray('MCPは無効になっています。基本的な対話モードで続行します。'));
  }
  
  console.log(chalk.gray('-----------------------------------'));
  console.log(chalk.cyan('会話を開始します。質問やコーディングタスクを入力してください。'));
  
  // 対話の履歴を保持
  const messages = [
    {
      role: 'system',
      content: mcpEnabled 
        ? `あなたはコーディングや技術的な質問を支援するAIアシスタントです。接続されているMCPサーバー: ${mcpServers.join(', ')}。これらのツールを使って様々なタスクを実行できます。`
        : 'あなたはコーディングや技術的な質問を支援するAIアシスタントです。プログラミング言語、アルゴリズム、技術的な問題について詳しく説明してください。'
    }
  ];
  
  // 対話ループ
  let running = true;
  while (running) {
    try {
      const { userInput } = await inquirer.prompt<{ userInput: string }>([
        {
          type: 'input',
          name: 'userInput',
          message: chalk.green('あなた:')
        }
      ]);
      
      // 終了コマンドをチェック
      if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
        running = false;
        continue;
      }
      
      // 空の入力をスキップ
      if (!userInput.trim()) {
        continue;
      }
      
      // ユーザーメッセージを追加
      messages.push({ role: 'user', content: userInput });
      
      console.log(chalk.gray('思考中...'));
      
      // モデルに送信
      const response = await provider.chatCompletion(messages);
      const content = response.choices[0].message.content;
      
      // アシスタントの応答を表示
      console.log(chalk.blue('アシスタント:'));
      console.log(content);
      
      // 応答をメッセージ履歴に追加
      messages.push({ role: 'assistant', content });
      
      console.log(chalk.gray('-----------------------------------'));
      
      // コードブロックを抽出 - もしユーザーが実行したいかどうか尋ねる
      const codeBlocks = extractCodeBlocks(content);
      // if (codeBlocks.length > 0) {
      //   const { runCode } = await inquirer.prompt<{ runCode: boolean }>([
      //     {
      //       type: 'confirm',
      //       name: 'runCode',
      //       message: '生成されたコードを実行しますか？',
      //       default: false
      //     }
      //   ]);
        
      //   if (runCode) {
      //     console.log(chalk.yellow('\n=== コード実行中 ===\n'));
          
      //     // サンドボックスを作成
      //     const sandbox = new DockerSandbox();
      //     try {
      //       const result = await sandbox.execute(codeBlocks[0]);
            
      //       console.log(chalk.yellow('\n=== 実行結果 ===\n'));
      //       if (result.success) {
      //         console.log(result.output);
              
      //         // 保存するか尋ねる
      //         const { save } = await inquirer.prompt<{ save: boolean }>([
      //           {
      //             type: 'confirm',
      //             name: 'save',
      //             message: 'このコードをファイルに保存しますか？',
      //             default: false
      //           }
      //         ]);
              
      //         if (save) {
      //           const { filename } = await inquirer.prompt<{ filename: string }>([
      //             {
      //               type: 'input',
      //               name: 'filename',
      //               message: 'ファイル名:',
      //               default: 'output.js'
      //             }
      //           ]);
                
      //           fs.writeFileSync(filename, codeBlocks[0]);
      //           console.log(chalk.green(`コードを${filename}に保存しました`));
      //         }
      //       } else {
      //         console.error(chalk.red('実行に失敗:'), result.error);
      //         if (result.stderr) {
      //           console.error(result.stderr);
      //         }
      //       }
      //     } catch (error) {
      //       console.error(chalk.red('コード実行エラー:'), error instanceof Error ? error.message : String(error));
      //     }
          
      //     console.log(chalk.gray('-----------------------------------'));
      //   }
      // }
    } catch (error) {
      console.error(chalk.red('エラー:'), error instanceof Error ? error.message : String(error));
      console.log(chalk.gray('-----------------------------------'));
    }
  }
  
  // 終了処理 - MCPサーバーのシャットダウン
  if (mcpEnabled && mcpServerManager) {
    console.log(chalk.gray('MCPサーバーをシャットダウンしています...'));
    try {
      // SDKクライアントを切断
      for (const [serverId, client] of sdkMcpClients.entries()) {
        try {
          // shutdownメソッドを呼び出す（サポートされている場合）
          try {
            await client.request({ method: "shutdown", params: {} }, EmptyResultSchema);
          } catch (e) {
            // shutdownがサポートされていない場合は無視
            console.log(`サーバー ${serverId} はshutdownメソッドをサポートしていません`);
          }
          console.log(`サーバー ${serverId} との接続を切断しました`);
        } catch (e) {
          console.warn(`サーバー ${serverId} との切断中にエラーが発生しました:`, e);
        }
      }
      
      // サーバープロセスを停止
      await mcpServerManager.stopAllServers();
      console.log(chalk.green('MCPサーバーをシャットダウンしました。'));
    } catch (error) {
      console.error(chalk.red('MCPサーバーのシャットダウンに失敗:'), error instanceof Error ? error.message : String(error));
    }
  }
  
  console.log(chalk.blue('対話モードを終了します。またお会いしましょう！'));
}

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
        choices: models.map((model: any) => model.name)
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
      // 設定ファイルを確認せずに自動的にMCPサーバーを初期化
      console.log('MCPサーバーを初期化中...');
      mcpServerManager = new MCPServerManager();
      const servers = await initializeMcpServers();
      if (servers.length > 0) {
        console.log(`${servers.length}個のMCPサーバーを起動しました。`);
      } else {
        console.log('MCPサーバーを初期化できませんでした。');
      }
    }
    
  } catch (error) {
    console.error('Ollamaサーバーへの接続エラー:', error instanceof Error ? error.message : String(error));
    console.log('Ollamaが実行中であることを確認して、もう一度お試しください。');
  }
}

// MCPサーバーのセットアップ (従来の選択式バージョン - 現在は使用しない)
async function setupMcpServersOld(): Promise<void> {
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
      const serverConfig = serverConfigs.find((s: ServerConfig) => s.id === serverId);
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

// タスク実行
export async function executeTask(config: OllamaCodeConfig, task: string): Promise<void> {
  console.log(`タスクを実行中: ${task}`);
  
  // プロバイダーを作成
  const provider = new OllamaProvider(config);
  
  // // サンドボックスを作成（必要な場合）
  // let sandbox: DockerSandbox | null = null;
  // if (config.sandbox && typeof config.sandbox !== 'string' && config.sandbox.type !== 'none') {
  //   sandbox = new DockerSandbox();
  //   console.log(`${config.sandbox.type}サンドボックスを使用してコードを実行します。`);
  // }
  
  // MCPサーバーを初期化（必要な場合）
  let mcpContext = '';
  if (config.mcp && config.mcp.enabled) {
    console.log('MCPサーバー情報を取得中...');
    
    // MCPサーバーマネージャーの初期化
    if (!mcpServerManager) {
      mcpServerManager = new MCPServerManager();
      
      // MCPサーバーを自動起動
      try {
        const startedServers = await initializeMcpServers();
        
        // 起動中のMCPサーバー情報を取得
        if (startedServers.length > 0) {
          mcpContext = `使用可能なMCPサーバー: ${startedServers.join(', ')}\n\n`+`これらのツールを使って様々なタスクを実行できます。`;
        }
      } catch (error) {
        console.warn('MCPサーバー初期化エラー:', error instanceof Error ? error.message : String(error));
      }
    }
  }
  
  // 現在のディレクトリ情報
  const currentDir = process.cwd();
  const dirInfo = fs.readdirSync(currentDir).slice(0, 20).join(', ');
  
  // メッセージを作成
  const messages = [
    {
      role: 'system',
      content: `あなたはコーディングや技術的な質問を支援するAIアシスタントです。`
    },
    {
      role: 'user',
      content: `${mcpContext}現在のディレクトリ: ${currentDir}\nファイル: ${dirInfo}\n\nタスク: ${task}`
    }
  ];
  
  // モデルに送信
  console.log('思考中...');
  const response = await provider.chatCompletion(messages);
  const content = response.choices[0].message.content;
  
  console.log('\n=== 回答 ===\n');
  console.log(content);
  
//   // コードブロックを抽出
//   const codeBlocks = extractCodeBlocks(content);
  
//   if (codeBlocks.length > 0 && sandbox) {
//     const { execute } = await inquirer.prompt<{ execute: boolean }>([
//       {
//         type: 'confirm',
//         name: 'execute',
//         message: 'このコードをサンドボックスで実行しますか？',
//         default: true
//       }
//     ]);
    
//     if (execute) {
//       console.log('\n=== コード実行中 ===\n');
//       const result = await sandbox.execute(codeBlocks[0]);
      
//       console.log('\n=== 実行結果 ===\n');
//       if (result.success) {
//         console.log(result.output);
        
//         // 保存するか尋ねる
//         const { save } = await inquirer.prompt<{ save: boolean }>([
//           {
//             type: 'confirm',
//             name: 'save',
//             message: 'このコードをファイルに保存しますか？',
//             default: true
//           }
//         ]);
        
//         if (save) {
//           const { filename } = await inquirer.prompt<{ filename: string }>([
//             {
//               type: 'input',
//               name: 'filename',
//               message: 'ファイル名:',
//               default: 'output.js'
//             }
//           ]);
          
//           fs.writeFileSync(filename, codeBlocks[0]);
//           console.log(`コードを${filename}に保存しました`);
//         }
//       } else {
//         console.error('実行に失敗:', result.error);
//         if (result.stderr) {
//           console.error(result.stderr);
//         }
//       }
//     }
//   }
}


// MCPサーバー初期化 - 自動で全てのサーバーを起動
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
    
    // すべてのサーバーを起動
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
        
        // サーバー起動
        await mcpServerManager?.startServer(config);
        return { id: config.id, success: true };
      } catch (error) {
        console.error(`サーバー起動エラー ${config.id}:`, error instanceof Error ? error.message : String(error));
        return { id: config.id, success: false, error };
      }
    });
    
    const results = await Promise.all(startPromises);
    const successful = results.filter(r => r.success).map(r => r.id);
    
    // 既存のクライアントマップをクリア
    sdkMcpClients.clear();
    
    // 各サーバーに接続
    for (const serverId of successful) {
      const config = serverConfigs.find((c: ServerConfig) => c.id === serverId);
      if (config) {
        try {
          // MCP SDKのStdioClientTransportを作成
          const transport = new StdioClientTransport({
            command: config.command,
            args: config.args || [],
            env: config.env ? { ...config.env } : undefined
          });
          
          // MCP SDKのClientを初期化
          const client = new Client(
            {
              name: "ollama-code-client",
              version: "1.0.0",
            },
            {
              capabilities: {
                tools: {},
              },
            }
          );
          
          // クライアントを接続
          await client.connect(transport);
          console.log(`サーバー ${serverId} にMCP SDKクライアントを接続しました`);
          
          // クライアントをマップに追加
          sdkMcpClients.set(serverId, client);
        } catch (error) {
          console.error(`サーバー ${serverId} への接続に失敗しました:`, error);
        }
      }
    }
    
    console.log(`MCPサーバー初期化完了: ${sdkMcpClients.size}/${serverConfigs.length}個のサーバーが接続されました`);
    return Array.from(sdkMcpClients.keys());
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
    
    // commandがtools/listの場合
    if (command === 'tools/list') {
      console.log('利用可能なツールを取得...');
      const allTools = await getAllTools(sdkMcpClients);
      
      // サーバーごとにツールを表示
      let toolCount = 0;
      for (const [serverId, tools] of Object.entries(allTools)) {
        console.log(`\n=== サーバー ${serverId} のツール ===`);
        
        // toolsが配列であることを確認してから処理
        const toolArray = Array.isArray(tools) ? tools : [];
        
        if (toolArray.length === 0) {
          console.log('ツールはありません');
          continue;
        }
        
        for (const tool of toolArray) {
          console.log(`- ${tool.name}: ${tool.description || '説明なし'}`);
          toolCount++;
        }
      }
      
      console.log(`\n合計${toolCount}個のツールが見つかりました`);
    } else if (command.startsWith('tools/call ')) {
      // tools/call の場合、フォーマット: tools/call ツール名 引数(JSON)
      const parts = command.split(' ');
      if (parts.length < 3) {
        console.error('不正なコマンド形式。例: tools/call tool_name {"arg1":"value1"}');
        return;
      }
      
      const toolName = parts[1];
      const argsJson = parts.slice(2).join(' ');
      
      try {
        const args = JSON.parse(argsJson);
        console.log(`ツール呼び出し: ${toolName} ${JSON.stringify(args)}`);
        
        // ツールを呼び出す
        const result = await callTool(sdkMcpClients, toolName, args);
        
        console.log('\n=== 実行結果 ===\n');
        
        // 結果の処理
        if (result.content && Array.isArray(result.content)) {
          // テキスト内容を表示 - 型アノテーションを追加
          const textContent = result.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('\n');
          
          console.log(textContent || '返答テキストがありません');
          
          // リソース内容を表示 - 型アノテーションを追加
          const resources = result.content
            .filter((c: any) => c.type === 'resource' && c.resource);
          
          if (resources.length > 0) {
            console.log('\n=== リソース ===\n');
            for (const resource of resources) {
              console.log(`URI: ${resource.resource?.uri}`);
              console.log(`MIMEタイプ: ${resource.resource?.mimeType}`);
              if (resource.resource?.text) {
                console.log(`内容:\n${resource.resource.text}`);
              }
            }
          }
        } else {
          // 構造化されていない結果の場合
          console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
        }
      } catch (e) {
        console.error('エラー:', e);
      }
    } else {
      console.error('未知のコマンド:', command);
      console.log('サポートされているコマンド: tools/list, tools/call');
    }
    
    console.log('MCPコマンド実行完了');
  } catch (error) {
    console.error('MCPコマンド実行エラー:', error instanceof Error ? error.message : String(error));
  }
}

