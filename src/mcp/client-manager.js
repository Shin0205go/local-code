import { MCPServerManager } from './server.js';

export class MCPClientManager {
  constructor() {
    this.clients = new Map(); // サーバーID -> クライアント
    this.mcpServerManager = new MCPServerManager();
    this.toolCapabilities = new Map(); // ツール名 -> 対応するサーバーIDのリスト
  }
  
  // 設定に基づいて全サーバーのクライアントを初期化
  async initializeAllClients() {
    // 設定からサーバーリストを取得
    const serverConfigs = await this.mcpServerManager.loadServerConfigs();
    
    if (serverConfigs.length === 0) {
      console.log('設定済みのMCPサーバーがありません');
      return 0;
    }
    
    console.log(`${serverConfigs.length}個のMCPサーバーを初期化中...`);
    
    // 各サーバーのクライアントを並行して初期化
    const initPromises = serverConfigs.map(async config => {
      try {
        console.log(`${config.name} (${config.id}) のクライアントを初期化中...`);
        const client = await this.mcpServerManager.getClient(config.id);
        this.clients.set(config.id, client);
        
        // サーバーのツール機能リストを取得（将来的に）
        // 現在はモックとして全サーバーが全ツールに対応していると想定
        
        return { id: config.id, success: true };
      } catch (error) {
        console.error(`${config.id} クライアントの初期化に失敗:`, error.message);
        return { id: config.id, success: false, error };
      }
    });
    
    const results = await Promise.all(initPromises);
    const successCount = results.filter(r => r.success).length;
    
    console.log(`${successCount}/${serverConfigs.length}個のMCPクライアントを初期化しました`);
    return successCount;
  }
  
  // 利用可能なクライアント数を返す
  getClientCount() {
    return this.clients.size;
  }
  
  // 特定のサーバーのツールリストを取得
  async getToolsForServer(serverId) {
    const client = this.clients.get(serverId);
    if (!client) {
      console.error(`サーバー ${serverId} のクライアントが見つかりません`);
      throw new Error(`サーバー ${serverId} のクライアントが見つかりません`);
    }
    
    try {
      // MCP tools/listの実装
      // 現在はモックとしていくつかのツールを返す
      const mockTools = [
        {
          name: `${serverId}_list_files`,
          description: 'ディレクトリ内のファイル一覧を取得します',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'ファイル一覧を取得するディレクトリのパス'
              }
            },
            required: ['path']
          }
        },
        {
          name: `${serverId}_read_file`,
          description: 'ファイルの内容を読み込みます',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: '読み込むファイルのパス'
              }
            },
            required: ['path']
          }
        },
        {
          name: `${serverId}_write_file`,
          description: 'ファイルに内容を書き込みます',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: '書き込むファイルのパス'
              },
              content: {
                type: 'string',
                description: '書き込む内容'
              }
            },
            required: ['path', 'content']
          }
        }
      ];
      
      return mockTools;
    } catch (error) {
      console.error(`ツールリスト取得エラー (${serverId}):`, error.message);
      throw error;
    }
  }
  
  // 特定のツールを呼び出す
  async callTool(serverId, toolName, args) {
    const client = this.clients.get(serverId);
    if (!client) {
      console.error(`サーバー ${serverId} のクライアントが見つかりません`);
      throw new Error(`サーバー ${serverId} のクライアントが見つかりません`);
    }
    
    try {
      // MCP tools/callの実装
      // 現在はモックとして結果を返す
      console.log(`サーバー ${serverId} でツール ${toolName} を呼び出し中...`);
      console.log(`引数: ${JSON.stringify(args)}`);
      
      // モック実装: ツール名に基づいてレスポンスを返す
      if (toolName.includes('list_files')) {
        return {
          content: [
            {
              type: 'text',
              text: `モック: ${args.path || '.'} 内のファイル一覧\n- file1.txt\n- file2.js\n- directory1/`
            }
          ],
          isError: false
        };
      } else if (toolName.includes('read_file')) {
        return {
          content: [
            {
              type: 'text',
              text: `モック: ${args.path} の内容\nこれはモックファイルの内容です。\nMCPサーバーがまだ実装されていないため、実際のファイル内容は取得できません。`
            }
          ],
          isError: false
        };
      } else if (toolName.includes('write_file')) {
        return {
          content: [
            {
              type: 'text',
              text: `モック: ${args.path} に内容を書き込みました (${args.content.length} バイト)`
            }
          ],
          isError: false
        };
      } else {
        return {
          content: [
            {
              type: 'text',
              text: `未知のツール: ${toolName}`
            }
          ],
          isError: true
        };
      }
    } catch (error) {
      console.error(`ツール呼び出しエラー (${serverId}.${toolName}):`, error.message);
      throw error;
    }
  }
  
  // ツール呼び出しを適切なクライアントにルーティング
  async routeToolCalls(toolCalls, task, context) {
    if (toolCalls.length === 0 || this.clients.size === 0) {
      return [];
    }
    
    console.log(`${toolCalls.length}個のツール呼び出しを${this.clients.size}個のMCPサーバーにルーティング中...`);
    
    const allResults = [];
    
    // 各ツール呼び出しに対して処理
    for (const toolCall of toolCalls) {
      const { action, actionInput } = toolCall;
      
      console.log(`ツール '${action}' の実行を試みます...`);
      
      // すべてのクライアントで実行を試みる
      const clientPromises = Array.from(this.clients.entries()).map(async ([serverId, client]) => {
        try {
          console.log(`${serverId} でツール '${action}' を実行中...`);
          
          const response = await client.executeTask({
            task,
            generatedCode: JSON.stringify(toolCall),
            context: {
              ...context,
              action,
              actionInput
            }
          });
          
          // 成功した結果があるか確認
          if (response.toolResults && response.toolResults.length > 0) {
            console.log(`${serverId} からツール '${action}' の結果を受信: ${response.toolResults.length}個`);
            return response.toolResults;
          } else {
            console.log(`${serverId} はツール '${action}' に対応していません`);
            return null;
          }
        } catch (error) {
          console.error(`${serverId} でのツール実行エラー:`, error.message);
          return null;
        }
      });
      
      // 並行して実行したすべての結果を取得
      const clientResults = await Promise.all(clientPromises);
      
      // 成功した結果をフィルタリング
      const successfulResults = clientResults
        .filter(result => result !== null)
        .flat()
        .filter(result => result.status === 'success');
      
      if (successfulResults.length > 0) {
        // 最初の成功した結果を使用
        allResults.push(successfulResults[0]);
        console.log(`ツール '${action}' の実行に成功しました`);
      } else {
        // 失敗した場合はエラー情報を追加
        allResults.push({
          action,
          status: 'error',
          error: 'すべてのMCPサーバーでツール実行に失敗しました'
        });
        console.log(`ツール '${action}' の実行に失敗しました`);
      }
    }
    
    return allResults;
  }
  
  // 複数のツールが含まれたレスポンスを処理
  async processToolCalls(content, task, context) {
    // ツール呼び出しを検出するパターン
    const toolCallPattern = /```json\s*\{\s*"action"\s*:\s*"([^"]+)"\s*,\s*"action_input"\s*:\s*(?:"([^"]*)"|(\{[\s\S]*?\}))\s*\}\s*```/g;
    
    // ツール呼び出しを検出
    const toolCalls = [];
    let match;
    
    while ((match = toolCallPattern.exec(content)) !== null) {
      const actionName = match[1];
      let actionInput = match[2] || match[3]; // 文字列かJSONオブジェクト文字列
      
      // JSONオブジェクトの場合はパース
      if (actionInput && actionInput.startsWith('{')) {
        try {
          actionInput = JSON.parse(actionInput);
        } catch (error) {
          console.error('JSONパースエラー:', error.message);
        }
      }
      
      toolCalls.push({
        action: actionName,
        actionInput
      });
    }
    
    if (toolCalls.length === 0) {
      console.log('ツール呼び出しは検出されませんでした');
      return { toolResults: [] };
    }
    
    console.log(`${toolCalls.length}個のツール呼び出しを検出しました:`);
    toolCalls.forEach((call, i) => {
      console.log(`[${i+1}] ${call.action}: ${JSON.stringify(call.actionInput)}`);
    });
    
    // ツールを実行
    const toolResults = await this.routeToolCalls(toolCalls, task, context);
    
    return {
      toolResults,
      task,
      message: `${toolResults.length}個のツールを実行しました`
    };
  }
}