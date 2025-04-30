#!/usr/bin/env node

import { Command } from 'commander';
import { setupWizard, executeTask, startChat, initializeMcpServers } from '../index.js';
import { loadConfig } from '../config.js';
import chalk from 'chalk';
import { MCPServerManager } from '../mcp/server.js';

const program = new Command();

program
  .name('ollama-code')
  .description('Ollamaモデルを使用したコーディング支援CLI')
  .version('0.1.0')
  .usage('[タスク...]')
  .option('--verbose', 'ログを詳細に表示する（デフォルトは静音モード）')
  .option('--debug', '詳細なデバッグログを表示する')
  .action(async () => {
    try {
      // コマンドラインオプションを取得
      const options = program.opts();
      
      // ログレベルを決定 - デフォルトはquiet
      const logLevel = options.debug ? 'debug' : (options.verbose ? 'info' : 'quiet');
      
      // 設定をロード
      const config = loadConfig();
      
      // MCPサーバーを先に初期化（設定で有効な場合のみ）
      if (config.mcp && config.mcp.enabled) {
        await initializeMcpServers({ logLevel });
      }
      
      // 引数があればタスク実行、なければ対話モード
      const args = program.args;
      if (args && args.length > 0) {
        // 全引数を連結してタスクとして扱う
        const task = args.join(' ');
        await executeTask(config, task, { logLevel });
      } else {
        // 対話モードを開始
        await startChat(config, { logLevel });
      }
    } catch (error) {
      console.error(chalk.red('実行に失敗:'), error instanceof Error ? error.message : String(error));
    }
  });

program
  .command('setup')
  .description('セットアップウィザードを実行')
  .action(async () => {
    try {
      await setupWizard();
    } catch (error) {
      console.error(chalk.red('セットアップに失敗:'), error instanceof Error ? error.message : String(error));
    }
  });

// MCPサーバー関連のコマンド - 上級者向け
const mcpCommand = program.command('mcp')
  .description('MCPサーバー管理コマンド');


mcpCommand
  .command('list')
  .description('MCPサーバー一覧を表示')
  .action(async () => {
    try {
      const { MCPServerManager } = await import('../mcp/server.js');
      const serverManager = new MCPServerManager();
      
      // 設定済みサーバー一覧
      const serverConfigs = await serverManager.loadServerConfigs();
      
      if (serverConfigs.length === 0) {
        console.log('設定済みのMCPサーバーがありません');
        return;
      }
      
      console.log('設定済みのMCPサーバー:');
      for (const config of serverConfigs) {
        const isRunning = serverManager.isServerRunning(config.id);
        const status = isRunning ? chalk.green('実行中') : chalk.gray('停止中');
        console.log(`- ${config.name} (${config.id}): ${status}`);
        console.log(`  コマンド: ${config.command} ${config.args?.join(' ') || ''}`);
      }
    } catch (error) {
      console.error(chalk.red('MCPサーバー一覧取得に失敗:'), error instanceof Error ? error.message : String(error));
    }
  });


// 引数を解析
program.parse();
