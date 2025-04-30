#!/usr/bin/env node

import { Command } from 'commander';
import { setupWizard, analyzeCode, executeTask, executeMcpCommand } from '../index.js';
import { loadConfig } from '../config.js';
import chalk from 'chalk';

const program = new Command();

program
  .name('ollama-code')
  .description('Ollamaモデルを使用したコーディング支援CLI')
  .version('0.1.0');

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
  .command('analyze [directory]')
  .description('ディレクトリ内のコードを解析')
  .action(async (directory = '.') => {
    try {
      const config = loadConfig();
      await analyzeCode(config, directory);
    } catch (error: any) {
      console.error(chalk.red('解析に失敗:'), error.message);
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
        if (!config.mcp) config.mcp = {};
        config.mcp.enabled = true;
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
      
      if (serverId) {
        // 指定されたサーバーのみ起動
        console.log(`MCPサーバー ${serverId} を起動中...`);
        await serverManager.startServerById(serverId, true);
        console.log(`MCPサーバー ${serverId} を起動しました`);
      } else {
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
      }
    } catch (error: any) {
      console.error(chalk.red('MCPサーバー起動に失敗:'), error.message);
    }
  });

mcpCommand
  .command('stop [serverId]')
  .description('MCPサーバーを停止')
  .action(async (serverId) => {
    try {
      const { MCPServerManager } = await import('../mcp/server.js');
      const serverManager = new MCPServerManager();
      
      if (serverId) {
        // 指定されたサーバーのみ停止
        console.log(`MCPサーバー ${serverId} を停止中...`);
        await serverManager.stopServer(serverId);
        console.log(`MCPサーバー ${serverId} を停止しました`);
      } else {
        // すべてのサーバーを停止
        console.log('すべてのMCPサーバーを停止中...');
        await serverManager.stopAllServers();
        console.log('すべてのMCPサーバーを停止しました');
      }
    } catch (error: any) {
      console.error(chalk.red('MCPサーバー停止に失敗:'), error.message);
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

mcpCommand
  .command('exec <serverId> <command>')
  .description('MCPサーバーにコマンドを送信')
  .action(async (serverId, command) => {
    try {
      await executeMcpCommand(serverId, command);
    } catch (error: any) {
      console.error(chalk.red('MCPコマンド実行に失敗:'), error.message);
    }
  });

program.parse();