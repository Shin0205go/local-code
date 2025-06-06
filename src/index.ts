import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
import { OllamaProvider } from './providers/ollama.js';
import { DockerSandbox } from './sandbox/docker.js';
import { saveConfig, loadConfig, OllamaCodeConfig } from './config.js';
import { MCPServerManager, MCPServerOptions } from './mcp/server.js';
import { ServerConfig } from './mcp/config.js';
import { OllamaMCPBridge } from './mcp/ollama-bridge.js';
import chalk from 'chalk';
// 必要なモジュールをインポート
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { EmptyResultSchema } from "@modelcontextprotocol/sdk/types.js";
// 自作モジュールからの関数インポート
import { getAllTools, callTool } from './mcp/client.js';
import { extractToolCalls, extractCodeBlocks } from './utils/extract.js';

// MCPサーバーマネージャー
let mcpServerManager: MCPServerManager | null = null;
// OllamaMCPブリッジ
let ollamaMCPBridge: OllamaMCPBridge | null = null;
// MCP SDKクライアントを格納するマップ
let sdkMcpClients: Map<string, Client> = new Map();
// グローバルログレベル
let globalLogLevel: string = 'quiet'; // デフォルトをquietに変更

// MCPサーバー初期化 - 自動で全てのサーバーを起動（エクスポート）
export async function initializeMcpServers(options: MCPServerOptions = {}): Promise<string[]> {
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
    
    // ログレベルが非静音モードならサーバー起動情報を表示
    if (options.logLevel !== 'quiet') {
      console.log(`${serverConfigs.length}個のMCPサーバーを起動中...`);
    }
    
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
        
        // サーバー起動（ログレベルを渡す）
        await mcpServerManager?.startServer(config, { 
          logLevel: options.logLevel 
        });
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
          // 環境変数にログレベルを設定
          const env = {
            ...config.env,
            // ログ抑制オプション
            NODE_ENV: options.logLevel === 'debug' ? 'development' : 'production',
            MCP_LOG_LEVEL: options.logLevel === 'quiet' ? 'error' : (options.logLevel === 'debug' ? 'debug' : 'info'),
            DEBUG: options.logLevel === 'debug' ? '1' : '0',
            QUIET: options.logLevel === 'quiet' ? '1' : '0'
          };
          
          // MCP SDKのStdioClientTransportを作成
          const transport = new StdioClientTransport({
            command: config.command,
            args: config.args || [],
            env
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
          
          // 非静音モードならログ出力
          if (options.logLevel !== 'quiet') {
            console.log(`サーバー ${serverId} にMCP SDKクライアントを接続しました`);
          }
          
          // クライアントをマップに追加
          sdkMcpClients.set(serverId, client);
        } catch (error) {
          console.error(`サーバー ${serverId} への接続に失敗しました:`, error);
        }
      }
    }
    
    // 非静音モードならログ出力
    if (options.logLevel !== 'quiet') {
      console.log(`MCPサーバー初期化完了: ${sdkMcpClients.size}/${serverConfigs.length}個のサーバーが接続されました`);
    }
    
    return Array.from(sdkMcpClients.keys());
  } catch (error) {
    console.error('MCPサーバー初期化エラー:', error instanceof Error ? error.message : String(error));
    return [];
  }
}

// 共通のAI処理関数
async function processWithAI(config: OllamaCodeConfig, input: string, options: {
  isInteractive?: boolean;
  history?: any[];
  logLevel?: string;
}): Promise<{
  content: string;
  toolCalls: { tool: string; args: any }[];
  codeBlocks: string[];
}> {
  // プロバイダーを作成
  const provider = new OllamaProvider(config);
  
  // MCPサーバーの初期化
  let mcpContext = '';
  let mcpTools: any[] = [];
  let mcpEnabled = false;
  
  if (config.mcp && config.mcp.enabled) {
    try {
      // MCPが有効だが初期化されていない場合
      if (!mcpServerManager || sdkMcpClients.size === 0) {
        if (options.logLevel !== 'quiet') {
          console.log('MCPサーバーが初期化されていないため、初期化を行います...');
        }
        await initializeMcpServers({
          logLevel: options.logLevel || globalLogLevel
        });
      }
      
      // 利用可能なサーバーを取得
      const servers = Array.from(sdkMcpClients.keys());
      
      if (servers.length > 0) {
        mcpEnabled = true;
        mcpContext = `使用可能なMCPサーバー: ${servers.join(', ')}\n\n`;
        
        // 利用可能なツール情報を取得
        const allTools = await getAllTools(sdkMcpClients);
        for (const [serverId, tools] of Object.entries(allTools)) {
          if (Array.isArray(tools) && tools.length > 0) {
            mcpTools = mcpTools.concat(tools.map((tool: any) => ({
              server: serverId,
              name: tool.name,
              description: tool.description || ''
            })));
          }
        }
      }
    } catch (error) {
      console.warn('MCPサーバー情報取得エラー:', error instanceof Error ? error.message : String(error));
    }
  }
  
  // システムプロンプトの準備
  let systemPrompt = 'あなたはコーディングタスクの実装を支援するエキスパートプログラマーです。';
  if (options.isInteractive) {
    systemPrompt += '対話形式でユーザーの質問に回答してください。';
  } else {
    systemPrompt += 'タスクを解決するJavaScriptコードを生成してください。';
  }
  
  // MCPツール情報を追加
  if (mcpEnabled && mcpTools.length > 0) {
    systemPrompt += '\n\n以下のMCPツールを使用できます：\n';
    systemPrompt += mcpTools.map((tool: any) => 
      `- ${tool.name} (${tool.server}): ${tool.description}`
    ).join('\n');
    
    systemPrompt += '\n\nツールを使用するには、以下の形式でコマンドを記述してください：\n';
    systemPrompt += '```\ntools/call ツール名 {"引数名":"値"}\n```\n';
  }
  
  // 現在のコンテキスト情報
  const currentDir = process.cwd();
  const dirInfo = fs.readdirSync(currentDir).slice(0, 20).join(', ');
  const contextInfo = `${mcpContext}現在のディレクトリ: ${currentDir}\nファイル: ${dirInfo}\n\n`;
  
  // メッセージの準備
  let messages;
  if (options.history && options.history.length > 0) {
    // 対話モードなら履歴を使用
    messages = [...options.history];
    if (messages[0].role === 'system') {
      // システムプロンプトを更新
      messages[0].content = systemPrompt;
    } else {
      // システムプロンプトを追加
      messages.unshift({ role: 'system', content: systemPrompt });
    }
    // 最新のユーザー入力を追加
    messages.push({ role: 'user', content: contextInfo + input });
  } else {
    // 単発タスクモードなら新しいメッセージを作成
    messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: contextInfo + (options.isInteractive ? input : `タスク: ${input}`) }
    ];
  }
  
  // モデルに送信
  const response = await provider.chatCompletion(messages);
  // adaptResponse関数により変換された形式を使用
  const content = response.choices?.[0]?.message?.content || '';
  
  // ツール呼び出しとコードブロックを抽出
  const toolCalls = extractToolCalls(content);
  const codeBlocks = extractCodeBlocks(content);
  
  return {
    content,
    toolCalls,
    codeBlocks
  };
}

// 対話モード
export async function startChat(config: OllamaCodeConfig, options: { logLevel?: string } = {}): Promise<void> {
  // グローバルログレベルを設定
  if (options.logLevel) {
    globalLogLevel = options.logLevel;
  }
  
  console.log(chalk.blue('Ollama Code 対話モード'));
  console.log(chalk.gray('-----------------------------------'));
  console.log('終了するには "exit" または "quit" と入力してください。');
  
  // 対話の履歴を保持
  const messages = [
    {
      role: 'system',
      content: '自動的に置き換えられます'  // processWithAI内で置換される
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
      
      console.log(chalk.blue('アシスタント:'));
      
      // ここでprocessWithAI関数を修正しstreamingを有効にする代わりに、
      // 直接OllamaProviderを使用してストリーミングレスポンスを処理
      
      // プロバイダーを作成
      const provider = new OllamaProvider(config);
      
      // システムプロンプトの準備
      let systemPrompt = 'あなたはコーディングタスクの実装を支援するエキスパートプログラマーです。';
      systemPrompt += '対話形式でユーザーの質問に回答してください。';
      
      // 現在のコンテキスト情報
      const currentDir = process.cwd();
      const dirInfo = fs.readdirSync(currentDir).slice(0, 20).join(', ');
      const contextInfo = `現在のディレクトリ: ${currentDir}\nファイル: ${dirInfo}\n\n`;
      
      // メッセージの準備
      let chatMessages;
      if (messages.length > 0) {
        // 対話モードなら履歴を使用
        chatMessages = [...messages];
        if (chatMessages[0].role === 'system') {
          // システムプロンプトを更新
          chatMessages[0].content = systemPrompt;
        } else {
          // システムプロンプトを追加
          chatMessages.unshift({ role: 'system', content: systemPrompt });
        }
        // 最新のユーザー入力を追加
        chatMessages.push({ role: 'user', content: contextInfo + userInput });
      } else {
        // 単発タスクモードなら新しいメッセージを作成
        chatMessages = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: contextInfo + userInput }
        ];
      }
      
      // ストリーミングモードでモデルに送信
      let responseContent = '';
      let responseTool_calls: any[] = [];  // ツール呼び出し情報を保存する配列

      // Ollamaモデルにチャットリクエストを送信し、ストリーミングで結果を取得
      const responseStream = await provider.chatCompletion(chatMessages, { stream: true });

      // ストリーミングレスポンスを処理
      for await (const part of responseStream) {
        // テキストコンテンツの処理
        const content = part.message?.content || '';
        responseContent += content;
        process.stdout.write(content);
        
        // ツール呼び出しの収集
        if (part.message?.tool_calls && part.message.tool_calls.length > 0) {
          for (const toolCall of part.message.tool_calls) {
            if (!responseTool_calls.some(tc => tc.id === toolCall.id)) {
              responseTool_calls.push(toolCall);
            }
          }
        }
      }

      console.log('\n');

      // 応答をメッセージ履歴に追加
      messages.push({ role: 'user', content: userInput });
      messages.push({ 
        role: 'assistant', 
        content: responseContent,
        // ツール呼び出しがあれば追加
        ...(responseTool_calls.length > 0 ? { tool_calls: responseTool_calls } : {})
      });

      console.log(chalk.gray('-----------------------------------'));

      // ollamaのツール呼び出し形式をollama-codeの形式に変換
      if (responseTool_calls.length > 0) {
        const toolCalls = responseTool_calls.map(tc => {
          try {
            return {
              tool: tc.function.name,
              args: JSON.parse(tc.function.arguments)
            };
          } catch (e) {
            console.warn('ツール引数のパースエラー:', e);
            return null;
          }
        }).filter((tc): tc is { tool: string; args: any } => tc !== null);
        
        if (toolCalls.length > 0) {
          await executeToolCalls(toolCalls);
        }
      } else {
        // ツール呼び出しがない場合は従来の方法で抽出を試みる
        const toolCalls = extractToolCalls(responseContent);
        if (toolCalls.length > 0) {
          await executeToolCalls(toolCalls);
        }
      }
    } catch (error) {
      console.error(chalk.red('エラー:'), error instanceof Error ? error.message : String(error));
      console.log(chalk.gray('-----------------------------------'));
    }
  }
  
  // 終了処理 - MCPサーバーのシャットダウン
  await shutdownMcpServers();
  
  console.log(chalk.blue('対話モードを終了します。またお会いしましょう！'));

  process.exit(0);
}


// ツール呼び出しの実行
async function executeToolCalls(toolCalls: { tool: string; args: any }[]): Promise<void> {
  if (toolCalls.length === 0) return;

  console.log('\n 🦙🔧 ツールの確認 🔧🦙 \n');
  // ツール呼び出しの概要を表示
  for (let i = 0; i < toolCalls.length; i++) {
    const call = toolCalls[i];
    console.log(`${i + 1}. ${call.tool} ${JSON.stringify(call.args)}`);
  }
  
  // ユーザーに実行の確認を取る
  const { executeTools } = await inquirer.prompt<{ executeTools: boolean }>([
    {
      type: 'confirm',
      name: 'executeTools',
      message: '上記のツールを実行しますか？',
      default: false
    }
  ]);
  
  if (!executeTools) {
    console.log('ツール実行をスキップしました。');
    return;
  }
  
  console.log('\n 🔧ツール呼び出しを実行中 🔧\n');
  
  for (const call of toolCalls) {
    try {
      console.log(`ツール実行: ${call.tool} ${JSON.stringify(call.args)}`);
      
      // サーバーIDを自動検出
      const serverId = await findServerForTool(sdkMcpClients, call.tool);
      
      if (!serverId) {
        console.error(`ツール "${call.tool}" をサポートするサーバーが見つかりません`);
        continue;
      }
      
      // ツールを実行
      console.log(`サーバー ${serverId} でツール ${call.tool} を実行中...`);
      const result = await callTool(sdkMcpClients, call.tool, call.args);
      
      console.log('\n 🔧 実行結果 🔧\n');
      
      // 結果の表示（複雑なデータ構造の場合のハンドリング）
      if (result.content && Array.isArray(result.content)) {
        // テキストコンテンツと各種リソースを表示
        displayToolResults(result);
      } else {
        // 単純な結果の表示
        console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
      }
    } catch (error) {
      console.error('ツール実行エラー:', error instanceof Error ? error.message : String(error));
    }
  }
  
}

// MCPサーバーのシャットダウン
async function shutdownMcpServers(): Promise<void> {
  if (mcpServerManager) {
    if (globalLogLevel !== 'quiet') {
      console.log(chalk.gray('MCPサーバーをシャットダウンしています...'));
    }
    
    try {
      // SDKクライアントを切断
      for (const [serverId, client] of sdkMcpClients.entries()) {
        try {
          // shutdownメソッドを呼び出す（サポートされている場合）
          try {
            await client.request({ method: "shutdown", params: {} }, EmptyResultSchema);
          } catch (e) {
            // shutdownがサポートされていない場合は無視（ログ出力しない）
          }
        } catch (e) {
          // 切断エラーは重要なので表示
          console.warn(`サーバー ${serverId} との切断中にエラーが発生しました:`, e);
        }
      }
      
      // サーバープロセスを停止
      await mcpServerManager.stopAllServers();
      
      if (globalLogLevel !== 'quiet') {
        console.log(chalk.green('MCPサーバーをシャットダウンしました。'));
      }
    } catch (error) {
      console.error(chalk.red('MCPサーバーのシャットダウンに失敗:'), error instanceof Error ? error.message : String(error));
    }
  }
}

// ヘルパー関数（ツール結果の表示）
function displayToolResults(result: any): void {
  if (!result.content || !Array.isArray(result.content)) return;
  
  // テキスト内容を表示
  const textContent = result.content
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('\n');
  
  if (textContent) {
    console.log(textContent);
  }
  
  // リソース内容を表示
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


// 指定されたツールをサポートするサーバーIDを探す
async function findServerForTool(
  clients: Map<string, Client>,
  toolName: string
): Promise<string | undefined> {
  // ツール名に "." が含まれる場合は、サーバーとツールを分割
  if (toolName.includes('.')) {
    const [serverId, actualTool] = toolName.split('.');
    // このサーバーが存在するか確認
    if (clients.has(serverId)) {
      return serverId;
    }
  }
  
  // 通常の検索: 全サーバーでツールを探す
  for (const [serverId, client] of clients.entries()) {
    try {
      const toolsResult = await client.listTools();
      if (toolsResult.tools.some(tool => tool.name === toolName)) {
        return serverId;
      }
    } catch (error) {
      console.error(`サーバー ${serverId} からツールリストを取得できませんでした:`, error);
    }
  }
  return undefined;
}

