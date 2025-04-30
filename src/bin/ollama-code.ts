#!/usr/bin/env node

import { Command } from 'commander';
import { setupWizard, executeTask, executeMcpCommand, startChat } from '../index.js';
import { loadConfig } from '../config.js';
import chalk from 'chalk';

const program = new Command();

program
  .name('ollama-code')
  .description('Ollamaモデルを使用したコーディング支援CLI')
  .version('0.1.0')
  .arguments('[task]') // タスクパラメータを追加
  .action(async (task) => {
    try {
      // 設定をロード
      const config = loadConfig();
      
      // タスクが指定された場合はタスク実行、そうでなければ対話モード
      if (task) {
        await executeTask(config, task);
      } else {
        // 対話モードを開始
        await startChat(config);
      }
    } catch (error:any) {
      console.error(chalk.red('実行に失敗:'), error.message);
    }
  });

program
  .command('setup')
  .description('セットアップウィザードを実行')
  .action(async () => {
    try {
      await setupWizard();
    } catch (error: any) {
      console.error(chalk.red('セットアップに失敗:'), error.message);
    }
  });

program
  .command('execute <task>')
  .description('コーディングタスクを実行')
  .option('-s, --sandbox', 'サンドボックス環境で実行')
  .option('-g, --github <repo>', 'GitHubリポジトリで実行')
  .option('-m, --mcp', 'MCPサーバーを使用')
  .action(async (task, options) => {
    try {
      const config = loadConfig();
      
      // オプションで設定を上書き
      if (options.sandbox) {
        config.sandbox = { type: 'docker', options: {} };
      }
      
      if (options.github) {
        config.github = options.github;
      }
      
      if (options.mcp) {
        // 空のオブジェクトに初期化する代わりに、enabledプロパティを持つオブジェクトを作成
        if (!config.mcp) config.mcp = { enabled: true };
        else config.mcp.enabled = true;
      }
      
      await executeTask(config, task);
    } catch (error: any) {
      console.error(chalk.red('実行に失敗:'), error.message);
    }
  });

// MCPサーバー関連のコマンド
const mcpCommand = program.command('mcp')
  .description('MCPサーバー管理コマンド');

mcpCommand
  .command('start [serverId]')
  .description('MCPサーバーを起動')
  .action(async (serverId) => {
    try {
      const { MCPServerManager } = await import('../mcp/server.js');
      const serverManager = new MCPServerManager();
      
      // すべてのサーバーを起動
      const serverConfigs = await serverManager.loadServerConfigs();
      
      if (serverConfigs.length === 0) {
        console.log('利用可能なMCPサーバーがありません');
        return;
      }
      
      console.log(`${serverConfigs.length}個のMCPサーバーを起動中...`);
      
      for (const config of serverConfigs) {
        try {
          console.log(`${config.name} (${config.id}) を起動中...`);
          await serverManager.startServer(config);
          console.log(`${config.name} (${config.id}) を起動しました`);
        } catch (error: any) {
          console.error(`${config.name} (${config.id}) の起動に失敗:`, error.message);
        }
      }
    } catch (error: any) {
      console.error(chalk.red('MCPサーバー起動に失敗:'), error.message);
    }
  });

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
    } catch (error: any) {
      console.error(chalk.red('MCPサーバー一覧取得に失敗:'), error.message);
    }
  });

program.parse();
