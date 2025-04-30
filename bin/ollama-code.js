#!/usr/bin/env node

import { Command } from 'commander';
import { setupWizard, analyzeCode, executeTask, startChat } from '../src/index.js';
import { loadConfig } from '../src/config.js';

const program = new Command();

// アプリケーション情報
program
  .name('ollama-code')
  .description('OllamaモデルとMCPを活用したコーディング支援CLI')
  .version('0.1.0');

// セットアップコマンド
program
  .command('setup')
  .description('Ollama Codeの初期設定を行います')
  .action(async () => {
    await setupWizard();
  });

// 詳細分析コマンド - パワーユーザー向け
program
  .command('analyze')
  .description('コードベースを詳細に解析します')
  .argument('[directory]', 'ディレクトリパス', process.cwd())
  .action(async (directory) => {
    const config = loadConfig();
    if (!config) {
      console.error('設定が見つかりません。最初に `ollama-code setup` を実行してください。');
      return;
    }
    
    await analyzeCode(config, directory);
  });

// 引数がコマンドではなく通常のテキストの場合は、それをタスクとして実行
if (process.argv.length > 2 && 
    !process.argv[2].startsWith('-') && 
    !['setup', 'analyze'].includes(process.argv[2])) {
  
  // スクリプト名と「node」を除く全ての引数を連結してタスクとする
  const task = process.argv.slice(2).join(' ');
  
  const config = loadConfig();
  if (!config) {
    console.error('設定が見つかりません。`ollama-code setup` を実行してください。');
    process.exit(1);
  }
  
  // タスクを実行
  executeTask(config, task);
} else if (process.argv.length === 2) {
  // 引数なしの場合は対話モードを開始
  const config = loadConfig();
  if (!config) {
    console.error('設定が見つかりません。`ollama-code setup` を実行してください。');
    console.log('セットアップを実行するには以下のコマンドを実行してください:');
    console.log('  ollama-code setup');
    process.exit(1);
  }
  
  // 対話モードを開始
  startChat(config);
} else {
  // 既存のコマンド処理（setup, analyzeなど）
  program.parse(process.argv);
}
