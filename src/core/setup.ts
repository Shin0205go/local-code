import inquirer from 'inquirer';
import path from 'path';
import { OllamaProvider } from '../providers/ollama.js';
import { MCPServerManager } from '../mcp/server.js';
import { saveConfig } from '../config.js';

/**
 * セットアップウィザード
 */
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
    
    // MCPサーバーのセットアップ
    if (useMcp) {
      await setupMcpServers();
    }
    
  } catch (error: any) {
    console.error('Ollamaサーバーへの接続エラー:', error.message);
    console.log('Ollamaが実行中であることを確認して、もう一度お試しください。');
  }
}

/**
 * MCPサーバーのセットアップ
 */
async function setupMcpServers(): Promise<void> {
  console.log('\nMCPサーバーのセットアップ');
  console.log('=====================');
  
  try {
    // MCPサーバーマネージャーの初期化
    const mcpServerManager = new MCPServerManager();
    
    // 設定ファイルを読み込む
    const serverConfigs = await mcpServerManager.loadServerConfigs();
    
    if (serverConfigs.length === 0) {
      console.log('利用可能なMCPサーバーがありません。設定ファイルを確認してください。');
      console.log('設定ファイルパス: ' + path.join(process.cwd(), 'config/mcp-config.json'));
      return;
    }
    
    // 起動するサーバーを選択
    const { selectedServers } = await inquirer.prompt([
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
    
    const startedServers = [];
    for (const serverId of selectedServers) {
      const serverConfig = serverConfigs.find(s => s.id === serverId);
      if (serverConfig) {
        try {
          console.log(`${serverConfig.name} (${serverId}) を起動中...`);
          await mcpServerManager.startServer(serverConfig);
          startedServers.push(serverId);
          console.log(`${serverConfig.name} (${serverId}) を起動しました`);
        } catch (error: any) {
          console.error(`${serverConfig.name} (${serverId}) の起動に失敗しました:`, error.message);
        }
      }
    }
    
    if (startedServers.length > 0) {
      console.log(`${startedServers.length}個のMCPサーバーを起動しました`);
    } else {
      console.log('MCPサーバーを起動できませんでした');
    }
  } catch (error: any) {
    console.error('MCPサーバーセットアップエラー:', error.message);
  }
}