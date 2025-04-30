#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const index_js_1 = require("../dist/index.js");
const config_js_1 = require("../dist/config.js");
const chalk_1 = __importDefault(require("chalk"));
const program = new commander_1.Command();
program
    .name('ollama-code')
    .description('Ollamaモデルを使用したコーディング支援CLI')
    .version('0.1.0');
program
    .command('setup')
    .description('セットアップウィザードを実行')
    .action(async () => {
    try {
        await (0, index_js_1.setupWizard)();
    }
    catch (error) {
        console.error(chalk_1.default.red('セットアップに失敗:'), error.message);
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
        const config = (0, config_js_1.loadConfig)();
        // オプションで設定を上書き
        if (options.sandbox) {
            config.sandbox = { type: 'docker', options: {} };
        }
        if (options.github) {
            config.github = options.github;
        }
        if (options.mcp) {
            // 空のオブジェクトに初期化する代わりに、enabledプロパティを持つオブジェクトを作成
            if (!config.mcp)
                config.mcp = { enabled: true };
            else
                config.mcp.enabled = true;
        }
        await (0, index_js_1.executeTask)(config, task);
    }
    catch (error) {
        console.error(chalk_1.default.red('実行に失敗:'), error.message);
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
        const { MCPServerManager } = await Promise.resolve().then(() => __importStar(require('../dist/mcp/server.js')));
        const serverManager = new MCPServerManager();
        if (serverId) {
            // 指定されたサーバーのみ起動
            console.log(`MCPサーバー ${serverId} を起動中...`);
            await serverManager.startServerById(serverId, true);
            console.log(`MCPサーバー ${serverId} を起動しました`);
        }
        else {
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
                }
                catch (error) {
                    console.error(`${config.name} (${config.id}) の起動に失敗:`, error.message);
                }
            }
        }
    }
    catch (error) {
        console.error(chalk_1.default.red('MCPサーバー起動に失敗:'), error.message);
    }
});
mcpCommand
    .command('stop [serverId]')
    .description('MCPサーバーを停止')
    .action(async (serverId) => {
    try {
        const { MCPServerManager } = await Promise.resolve().then(() => __importStar(require('../dist/mcp/server.js')));
        const serverManager = new MCPServerManager();
        if (serverId) {
            // 指定されたサーバーのみ停止
            console.log(`MCPサーバー ${serverId} を停止中...`);
            await serverManager.stopServer(serverId);
            console.log(`MCPサーバー ${serverId} を停止しました`);
        }
        else {
            // すべてのサーバーを停止
            console.log('すべてのMCPサーバーを停止中...');
            await serverManager.stopAllServers();
            console.log('すべてのMCPサーバーを停止しました');
        }
    }
    catch (error) {
        console.error(chalk_1.default.red('MCPサーバー停止に失敗:'), error.message);
    }
});
mcpCommand
    .command('list')
    .description('MCPサーバー一覧を表示')
    .action(async () => {
    try {
        const { MCPServerManager } = await Promise.resolve().then(() => __importStar(require('../dist/mcp/server.js')));
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
            const status = isRunning ? chalk_1.default.green('実行中') : chalk_1.default.gray('停止中');
            console.log(`- ${config.name} (${config.id}): ${status}`);
            console.log(`  コマンド: ${config.command} ${config.args?.join(' ') || ''}`);
        }
    }
    catch (error) {
        console.error(chalk_1.default.red('MCPサーバー一覧取得に失敗:'), error.message);
    }
});
mcpCommand
    .command('exec <serverId> <command>')
    .description('MCPサーバーにコマンドを送信')
    .action(async (serverId, command) => {
    try {
        await (0, index_js_1.executeMcpCommand)(serverId, command);
    }
    catch (error) {
        console.error(chalk_1.default.red('MCPコマンド実行に失敗:'), error.message);
    }
});

// mcp-chatコマンドを追加
program
    .command('mcp-chat')
    .description('MCP対応チャットモードを開始')
    .action(async () => {
    try {
        const { executeMCPChat } = await Promise.resolve().then(() => __importStar(require('../dist/commands/mcp-chat.js')));
        await executeMCPChat();
    }
    catch (error) {
        console.error(chalk_1.default.red('MCPチャット実行に失敗:'), error.message);
    }
});

program.parse();
