/**
 * MCP対応チャットコマンド
 * OllamaモデルとMCP統合のチャットコマンド
 */

import inquirer from 'inquirer';
import chalk from 'chalk';
import { OllamaWithMCPProvider } from '../providers/ollama-with-mcp';
import { loadConfig, OllamaCodeConfig } from '../config';

/**
 * MCP対応チャットコマンドを実行
 */
export async function executeMCPChat(): Promise<void> {
  try {
    console.log(chalk.blue('Ollama + MCP 対話モード'));
    console.log(chalk.gray('-----------------------------------'));
    
    // 設定を読み込む
    const config = loadConfig();
    if (!config || !config.model) {
      console.error(chalk.red('エラー: 設定が見つからないか不完全です。セットアップを実行してください。'));
      console.log(chalk.yellow('実行例: ollama-code setup'));
      return;
    }
    
    // MCP設定がない場合は追加
    if (!config.mcp) {
      config.mcp = { enabled: true };
    } else {
      // 既存の設定でMCPを有効にする
      config.mcp.enabled = true;
    }
    
    // MCP対応プロバイダーを初期化
    const provider = new OllamaWithMCPProvider({
      baseURL: config.baseURL,
      model: config.model,
      mcpEnabled: true
    });
    
    console.log(chalk.yellow(`モデル: ${config.model}`));
    console.log(chalk.yellow('MCPサーバーを初期化中...'));
    
    // MCPを初期化
    const serverIds = await provider.initializeMCP();
    if (serverIds.length > 0) {
      console.log(chalk.green(`${serverIds.length}個のMCPサーバーを起動しました: ${serverIds.join(', ')}`));
    } else {
      console.log(chalk.yellow('MCPサーバーが起動されていません。MCPツールは利用できません。'));
    }
    
    console.log(chalk.gray('-----------------------------------'));
    console.log(chalk.cyan('会話を開始します。終了するには "exit" または "quit" と入力してください。'));
    console.log(chalk.gray('-----------------------------------'));
    
    // 対話の履歴を保持
    const messages = [
      {
        role: 'system',
        content: `あなたはユーザーを支援するAIアシスタントです。接続されているMCPサーバー: ${serverIds.join(', ')}。
これらのMCPツールは、ユーザーの質問に答えるために使用できます。
適切なタイミングでツールを使用してください。MCP tools/listとtools/callは自動的に処理されます。`
      }
    ];
    
    // 対話ループ
    let running = true;
    while (running) {
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
      
      // ユーザーメッセージを追加
      messages.push({ role: 'user', content: userInput });
      
      try {
        console.log(chalk.gray('思考中...'));
        
        // ツール機能付きでモデルを呼び出し
        const response = await provider.chatCompletionWithTools(messages, {
          temperature: 0.7,
          max_tokens: 2000
        });
        
        const assistantMessage = response.choices[0].message;
        
        // アシスタントの応答を表示
        console.log(chalk.blue('アシスタント:'));
        console.log(assistantMessage.content);
        
        // 応答をメッセージ履歴に追加
        messages.push({ role: 'assistant', content: assistantMessage.content });
        
        console.log(chalk.gray('-----------------------------------'));
      } catch (error) {
        console.error(chalk.red('エラー:'), error instanceof Error ? error.message : String(error));
        console.log(chalk.gray('-----------------------------------'));
      }
    }
    
    console.log(chalk.yellow('会話を終了します...'));
    
    // MCPをシャットダウン
    await provider.shutdownMCP();
    
    console.log(chalk.green('終了しました。'));
  } catch (error) {
    console.error(chalk.red('MCPチャットエラー:'), error instanceof Error ? error.message : String(error));
  }
}