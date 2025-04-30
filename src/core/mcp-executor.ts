import { MCPServerManager } from '../mcp/server.js';

// MCPサーバーマネージャー
let mcpServerManager: MCPServerManager | null = null;

/**
 * MCPサーバー初期化
 */
export async function initializeMcpServers(): Promise<string[]> {
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
    
    // 各サーバーを起動
    console.log(`${serverConfigs.length}個のMCPサーバーを起動中...`);
    
    const startPromises = serverConfigs.map(async config => {
      try {
        // すでに実行中なら何もしない
        if (mcpServerManager?.isServerRunning(config.id)) {
          return { id: config.id, success: true };
        }
        
        console.log(`サーバー起動: ${config.name} (${config.id})`);
        await mcpServerManager?.startServer(config);
        return { id: config.id, success: true };
      } catch (error: any) {
        console.error(`サーバー起動エラー ${config.id}:`, error.message);
        return { id: config.id, success: false, error };
      }
    });
    
    const results = await Promise.all(startPromises);
    const successful = results.filter(r => r.success).map(r => r.id);
    
    console.log(`MCPサーバー初期化完了: ${successful.length}/${serverConfigs.length}個のサーバーが起動しました`);
    return successful;
  } catch (error: any) {
    console.error('MCPサーバー初期化エラー:', error.message);
    return [];
  }
}

/**
 * MCPコマンドの実行
 */
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
    
    // ここでMCPサーバーにコマンドを送信する処理を実装
    // 現在のところ、MCPの実装はモックのみ
    
    console.log('MCPコマンド実行完了');
  } catch (error: any) {
    console.error('MCPコマンド実行エラー:', error.message);
  }
}