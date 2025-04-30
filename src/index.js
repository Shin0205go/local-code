import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { OllamaProvider } from './providers/ollama.js';
import { DockerSandbox } from './sandbox/docker.js';
import { saveConfig, loadConfig } from './config.js';
import { MCPServerManager } from './mcp/server.js';
import { MCPClientManager } from './mcp/client-manager.js';

// MCPクライアントマネージャー
let mcpClientManager = null;
// MCPサーバーマネージャー
let mcpServerManager = null;

// 対話モードを開始
export async function startChat(config) {
  console.log(chalk.blue('Ollama Code 対話モード'));
  console.log(chalk.gray('-----------------------------------'));
  console.log(chalk.yellow(`モデル: ${config.model}`));
  
  // プロバイダーを作成
  const provider = new OllamaProvider(config);
  
  // サンドボックスを作成（必要な場合）
  let sandbox = null;
  if (config.sandbox && typeof config.sandbox !== 'string' && config.sandbox.type !== 'none') {
    sandbox = new DockerSandbox();
    console.log(chalk.yellow(`${config.sandbox.type}サンドボックスを使用可能`));
  }
  
  // MCPサーバーを初期化（必要な場合）
  if (config.mcp && config.mcp.enabled) {
    console.log(chalk.yellow('MCPサーバーを初期化中...'));
    
    // MCPクライアントマネージャーの初期化
    if (!mcpClientManager) {
      mcpClientManager = new MCPClientManager();
      
      // すべてのMCPクライアントを初期化
      const clientCount = await mcpClientManager.initializeAllClients();
      if (clientCount === 0) {
        console.log(chalk.yellow('利用可能なMCPサーバーがありません。MCPは無効化されます。'));
        config.mcp.enabled = false;
      } else {
        console.log(chalk.green(`${clientCount}個のMCPサーバーに接続しました`));
      }
    }
  }
  
  // 対話の履歴を保持
  const messages = [
    {
      role: 'system',
      content: `あなたはユーザーを支援するAIアシスタントです。
JavaScriptとTypeScriptの専門知識を持ち、プログラミングの質問に詳しく答えることができます。
必要に応じてコードを生成し、実行方法も説明してください。

${config.mcp && config.mcp.enabled ? 'ツールの使用が必要な場合は、以下の形式でJSONを出力できます:\n```json\n{"action": "ツール名", "action_input": {...}}\n```\n\nツールを使用した結果は別途提供されます。' : ''}
`
    }
  ];
  
  console.log(chalk.gray('-----------------------------------'));
  console.log(chalk.cyan('会話を開始します。終了するには "exit" または "quit" と入力してください。'));
  console.log(chalk.gray('-----------------------------------'));
  
  // 対話ループ
  let running = true;
  while (running) {
    const { userInput } = await inquirer.prompt([
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
    
    // ユーザーメッセージを追加
    messages.push({ role: 'user', content: userInput });
    
    try {
      console.log(chalk.gray('思考中...'));
      
      // モデルに送信
      const response = await provider.chatCompletion(messages);
      const content = response.choices[0].message.content;
      
      // MCPツール処理（有効な場合）
      if (config.mcp && config.mcp.enabled && mcpClientManager) {
        try {
          // ツール呼び出しの処理
          const mcpResponse = await mcpClientManager.processToolCalls(content, userInput, {
            currentDir: process.cwd(),
            timestamp: new Date().toISOString()
          });
          
          if (mcpResponse.toolResults && mcpResponse.toolResults.length > 0) {
            console.log(chalk.yellow(`\n${mcpResponse.toolResults.length}個のツールを実行中...\n`));
            
            // ツール結果を使用して2回目のプロンプトを送信
            const toolResultsFormatted = mcpResponse.toolResults.map(result => 
              `ツール: ${result.action}\n状態: ${result.status}\n結果: ${JSON.stringify(result.result, null, 2)}`
            ).join('\n\n');
            
            const followupMessages = [
              ...messages,
              { role: 'assistant', content: content },
              { 
                role: 'user', 
                content: `ツール実行結果:\n\n${toolResultsFormatted}\n\nこれらの結果を使って、元の質問に回答してください。`
              }
            ];
            
            // 2回目のレスポンスを取得
            const secondResponse = await provider.chatCompletion(followupMessages);
            const secondContent = secondResponse.choices[0].message.content;
            
            // アシスタントの応答を表示
            console.log(chalk.blue('アシスタント:'));
            console.log(secondContent);
            
            // 応答をメッセージ履歴に追加
            messages.push({ role: 'assistant', content: secondContent });
          } else {
            // ツール呼び出しがない場合は通常の応答
            console.log(chalk.blue('アシスタント:'));
            console.log(content);
            
            // 応答をメッセージ履歴に追加
            messages.push({ role: 'assistant', content: content });
          }
        } catch (error) {
          console.error(chalk.red('MCPツール処理エラー:', error.message));
          
          // エラー時も通常の応答を表示
          console.log(chalk.blue('アシスタント:'));
          console.log(content);
          
          // 応答をメッセージ履歴に追加
          messages.push({ role: 'assistant', content: content });
        }
      } else {
        // MCP無効時は通常の応答
        console.log(chalk.blue('アシスタント:'));
        console.log(content);
        
        // 応答をメッセージ履歴に追加
        messages.push({ role: 'assistant', content: content });
      }
      
      // コードブロックを検査
      const codeBlocks = extractCodeBlocks(messages[messages.length - 1].content);
      if (codeBlocks.length > 0 && sandbox) {
        const { execute } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'execute',
            message: 'コードブロックが検出されました。サンドボックスで実行しますか？',
            default: false
          }
        ]);
        
        if (execute) {
          await executeSandboxCode(sandbox, codeBlocks[0]);
        }
      }
      
      console.log(chalk.gray('-----------------------------------'));
    } catch (error) {
      console.error(chalk.red('エラー:'), error.message);
      console.log(chalk.gray('-----------------------------------'));
    }
  }
  
  console.log(chalk.yellow('会話を終了します。またのご利用をお待ちしています。'));
}

// MCP対応ollama-codeのモック版
export async function executeMcpCommand(serverId, command) {
  try {
    console.log(`MCPコマンド実行: ${serverId} - ${command}`);
    
    // MCPサーバーマネージャーの初期化
    if (!mcpServerManager) {
      mcpServerManager = new MCPServerManager();
      console.log('MCPサーバーマネージャーを初期化しました');
    }
    
    // クライアントマネージャーの初期化
    if (!mcpClientManager) {
      mcpClientManager = new MCPClientManager();
      console.log('MCPクライアントマネージャーを初期化しました');
      await mcpClientManager.initializeAllClients();
    }
    
    // コマンドを解析
    if (command === 'tools/list') {
      // ツールリストを取得
      console.log(`サーバー ${serverId} で利用可能なツールを取得中...`);
      const tools = await mcpClientManager.getToolsForServer(serverId);
      
      if (tools && tools.length > 0) {
        console.log(`${tools.length}個のツールが見つかりました:`);
        tools.forEach(tool => {
          console.log(`- ${tool.name}: ${tool.description || 'No description'}`);
        });
      } else {
        console.log('利用可能なツールが見つかりませんでした');
      }
    } else if (command.startsWith('tools/call ')) {
      // ツール呼び出し
      // "tools/call tool_name {...}"の形式
      // 最初の空白で分割してtool_nameを取得
      const firstSpaceIndex = command.indexOf(' ', 'tools/call '.length);
      if (firstSpaceIndex === -1) {
        console.error('不正なコマンド形式。例: tools/call tool_name {"arg1":"value1"}');
        return;
      }
      
      const toolName = command.substring('tools/call '.length, firstSpaceIndex);
      const argsJson = command.substring(firstSpaceIndex + 1);
      
      console.log(`ツール名: ${toolName}`);
      console.log(`引数JSON: ${argsJson}`);
      
      try {
        const args = JSON.parse(argsJson);
        console.log(`ツール呼び出し: ${toolName} ${JSON.stringify(args)}`);
        
        // ツールを呼び出し
        const result = await mcpClientManager.callTool(serverId, toolName, args);
        
        console.log('\n=== 実行結果 ===\n');
        if (result.content) {
          // テキスト内容を表示
          result.content.forEach(item => {
            if (item.type === 'text') {
              console.log(item.text);
            } else if (item.type === 'resource' && item.resource) {
              console.log(`[Resource] ${item.resource.uri}: ${item.resource.text || '(バイナリデータ)'}`);
            }
          });
        } else {
          console.log(JSON.stringify(result, null, 2));
        }
      } catch (e) {
        console.error('引数のJSONパースに失敗:', e.message);
      }
    } else {
      console.error('未知のコマンド:', command);
      console.log('サポートされているコマンド: tools/list, tools/call tool_name {...}');
    }
  } catch (error) {
    console.error('MCPコマンド実行エラー:', error.message);
  }
}

// タスク実行
export async function executeTask(config, task) {
  console.log(`タスクを実行中: ${task}`);
  
  // プロバイダーを作成
  const provider = new OllamaProvider(config);
  
  // サンドボックスを作成（必要な場合）
  let sandbox = null;
  if (config.sandbox && config.sandbox.type !== 'none') {
    sandbox = new DockerSandbox();
    console.log(`${config.sandbox.type}サンドボックスを使用してコードを実行します。`);
  }
  
  // MCPクライアントマネージャーを初期化（必要な場合）
  if (config.mcp && config.mcp.enabled) {
    console.log('\n=== MCPセッション開始 ===');
    console.log('MCPサーバーを使用してタスクを実行します');
    
    // MCPクライアントマネージャーの初期化
    if (!mcpClientManager) {
      mcpClientManager = new MCPClientManager();
      console.log('MCPクライアントマネージャーを初期化しました');
      
      // すべてのMCPクライアントを初期化
      const clientCount = await mcpClientManager.initializeAllClients();
      if (clientCount === 0) {
        console.log('利用可能なMCPクライアントがないため、MCPは無効化されます');
        config.mcp.enabled = false;
      } else {
        console.log(`${clientCount}個のMCPクライアントが利用可能です`);
      }
    }
  }
  
  // メッセージを作成
  const messages = [
    {
      role: 'system',
      content: `あなたはユーザーを支援するAIアシスタントです。
JavaScriptとTypeScriptの専門知識を持ち、プログラミングの質問に詳しく答えることができます。
必要に応じてコードを生成し、実行方法も説明してください。

${config.mcp && config.mcp.enabled ? 'ツールの使用が必要な場合は、以下の形式でJSONを出力できます:\n```json\n{"action": "ツール名", "action_input": {...}}\n```\n\nツールを使用した結果は別途提供されます。' : ''}
`
    },
    {
      role: 'user',
      content: `現在のディレクトリ: ${process.cwd()}\n\nタスク: ${task}`
    }
  ];
  
  // モデルに送信
  console.log('Ollamaモデルに送信中...');
  console.log('使用モデル:', config.model);
  
  const response = await provider.chatCompletion(messages);
  const content = response.choices[0].message.content;
  
  // Ollamaの応答サイズをログ
  console.log('Ollamaからの応答を受信 (サイズ: ' + content.length + ' バイト)');
  
  // MCP処理（有効な場合）
  if (config.mcp && config.mcp.enabled && mcpClientManager && mcpClientManager.getClientCount() > 0) {
    console.log('\n=== MCPツール処理開始 ===');
    
    try {
      // ツール呼び出しの処理
      const mcpResponse = await mcpClientManager.processToolCalls(content, task, {
        currentDir: process.cwd(),
        timestamp: new Date().toISOString()
      });
      
      console.log('\n=== MCPツール処理結果 ===');
      
      if (mcpResponse.toolResults && mcpResponse.toolResults.length > 0) {
        console.log(`${mcpResponse.toolResults.length}個のツールが実行されました:\n`);
        
        // ツール実行結果を表示
        mcpResponse.toolResults.forEach((result, index) => {
          console.log(`[ツール ${index + 1}] ${result.action} (${result.status})`);
          
          if (result.status === 'success') {
            console.log('結果:', JSON.stringify(result.result, null, 2));
          } else {
            console.log('エラー:', result.error);
          }
          console.log('---');
        });
        
        // ツール結果を使用して2回目のプロンプトを送信
        const toolResultsFormatted = mcpResponse.toolResults.map(result => 
          `ツール: ${result.action}\n状態: ${result.status}\n結果: ${JSON.stringify(result.result, null, 2)}`
        ).join('\n\n');
        
        const followupMessages = [
          ...messages,
          { role: 'assistant', content: content },
          { 
            role: 'user', 
            content: `ツール実行結果を受け取りました:\n\n${toolResultsFormatted}\n\nこれらの結果を使って、元のタスクを完了してください。`
          }
        ];
        
        console.log('\n=== ツール結果を使用して再度問い合わせ中... ===');
        
        // 2回目のレスポンスを取得
        const secondResponse = await provider.chatCompletion(followupMessages);
        const secondContent = secondResponse.choices[0].message.content;
        
        console.log('\n=== 最終結果 ===\n');
        console.log(secondContent);
        
        // コードブロックを抽出してサンドボックスで実行（必要な場合）
        if (sandbox) {
          const codeBlocks = extractCodeBlocks(secondContent);
          if (codeBlocks.length > 0) {
            await executeSandboxCode(sandbox, codeBlocks[0]);
          }
        }
        
        return;
      } else {
        console.log('ツール呼び出しは検出されませんでした');
      }
    } catch (error) {
      console.error('MCP処理エラー:', error.message);
    }
  }
  
  // 通常の結果表示（MCPが使用されなかった場合）
  console.log('\n=== 生成されたソリューション ===\n');
  console.log(content);
  
  // コードブロックを抽出
  const codeBlocks = extractCodeBlocks(content);
  
  if (codeBlocks.length > 0 && sandbox) {
    await executeSandboxCode(sandbox, codeBlocks[0]);
  }
}

// サンドボックスでコードを実行
async function executeSandboxCode(sandbox, code) {
  const { execute } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'execute',
      message: 'このコードをサンドボックスで実行しますか？',
      default: true
    }
  ]);
  
  if (execute) {
    console.log('\n=== コード実行中 ===\n');
    console.log('コードをサンドボックスに送信中...');
    
    const result = await sandbox.execute(code);
    
    console.log('\n=== 実行結果 ===\n');
    if (result.success) {
      console.log(result.output);
      
      // 保存するか尋ねる
      const { save } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'save',
          message: 'このコードをファイルに保存しますか？',
          default: true
        }
      ]);
      
      if (save) {
        const { filename } = await inquirer.prompt([
          {
            type: 'input',
            name: 'filename',
            message: 'ファイル名:',
            default: 'output.js'
          }
        ]);
        
        fs.writeFileSync(filename, code);
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

// マークダウンからコードブロックを抽出
function extractCodeBlocks(text) {
  const codeBlockRegex = /```(?:javascript|js)?\n([\s\S]*?)```/g;
  const blocks = [];
  let match;
  
  while ((match = codeBlockRegex.exec(text)) !== null) {
    blocks.push(match[1]);
  }
  
  return blocks;
}

// コード解析
export async function analyzeCode(config, directory) {
  console.log(`ディレクトリを解析中: ${directory}`);
  
  // プロバイダーを作成
  const provider = new OllamaProvider(config);
  
  // 関連ファイルを取得
  const files = await getRelevantFiles(directory);
  console.log(`関連ファイルが${files.length}個見つかりました。`);
  
  // ファイル内容を読み込む（最大10ファイル、合計30KB）
  const fileContents = [];
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

// 関連コードファイルを取得
async function getRelevantFiles(directory, options = {}) {
  const maxDepth = options.maxDepth || 3;
  const ignoreDirs = options.ignoreDirs || ['node_modules', '.git', 'dist', 'build', '.cache'];
  const extensions = options.extensions || ['.js', '.ts', '.jsx', '.tsx', '.json', '.md'];
  
  function walkDir(dir, depth = 0) {
    if (depth > maxDepth) return [];
    
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    
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

// セットアップウィザード
export async function setupWizard() {
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
    
    const { modelName } = await inquirer.prompt([
      {
        type: 'list',
        name: 'modelName',
        message: '使用するモデルを選択：',
        choices: models.map(model => model.name)
      }
    ]);
    
    const { sandboxType } = await inquirer.prompt([
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
    const { useMcp } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useMcp',
        message: 'MCPサーバーを使用しますか？',
        default: false
      }
    ]);
    
    // 設定を保存
    const config = {
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
    
    // MCPサーバーの初期化（有効な場合）
    if (useMcp) {
      // MCPクライアントマネージャーの初期化
      mcpClientManager = new MCPClientManager();
      
      // 利用可能なMCPサーバーを初期化
      await mcpClientManager.initializeAllClients();
    }
  } catch (error) {
    console.error('Ollamaサーバーへの接続エラー:', error.message);
    console.log('Ollamaが実行中であることを確認して、もう一度お試しください。');
  }
}