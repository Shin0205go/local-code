import fs from 'fs';
import path from 'path';
import { OllamaProvider } from '../providers/ollama.js';
import { OllamaCodeConfig } from '../config.js';

interface FileContent {
  path: string;
  content: string;
}

/**
 * コード解析
 */
export async function analyzeCode(config: OllamaCodeConfig, directory: string): Promise<void> {
  console.log(`ディレクトリを解析中: ${directory}`);
  
  // プロバイダーを作成
  const provider = new OllamaProvider(config);
  
  // 関連ファイルを取得
  const files = await getRelevantFiles(directory);
  console.log(`関連ファイルが${files.length}個見つかりました。`);
  
  // ファイル内容を読み込む（最大10ファイル、合計30KB）
  const fileContents: FileContent[] = [];
  let totalSize = 0;
  const maxSize = 30 * 1024; // 30KB
  
  for (let i = 0; i < Math.min(files.length, 10); i++) {
    const filePath = files[i];
    const content = fs.readFileSync(filePath, 'utf8');
    
    totalSize += content.length;
    if (totalSize > maxSize) {
      console.log(`サイズ制限に達しました。${i}個のファイルを解析します。`);
      break;
    }
    
    fileContents.push({
      path: filePath,
      content: content.length > 2000 ? content.substring(0, 2000) + '...' : content
    });
  }
  
  // モデル用のメッセージを作成
  const messages = [
    {
      role: 'system',
      content: 'あなたはコードベースを解析し、明確かつ簡潔に説明するエキスパートプログラマーです。構造、パターン、主要コンポーネントを特定し、必要に応じて改善提案も行ってください。'
    },
    {
      role: 'user',
      content: `以下のコードベースを解析してください:\n\n${
        fileContents.map(f => `FILE: ${f.path}\n\n${f.content}`).join('\n\n')
      }`
    }
  ];
  
  // モデルに送信
  console.log('モデルにコードの解析を依頼中...');
  const response = await provider.chatCompletion(messages);
  
  console.log('\n=== 解析結果 ===\n');
  console.log(response.choices[0].message.content);
}

/**
 * 関連コードファイルを取得
 */
interface FileOptions {
  maxDepth?: number;
  ignoreDirs?: string[];
  extensions?: string[];
}

async function getRelevantFiles(directory: string, options: FileOptions = {}): Promise<string[]> {
  const maxDepth = options.maxDepth || 3;
  const ignoreDirs = options.ignoreDirs || ['node_modules', '.git', 'dist', 'build', '.cache'];
  const extensions = options.extensions || ['.js', '.ts', '.jsx', '.tsx', '.json', '.md'];
  
  function walkDir(dir: string, depth = 0): string[] {
    if (depth > maxDepth) return [];
    
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        if (!ignoreDirs.includes(entry.name)) {
          files.push(...walkDir(fullPath, depth + 1));
        }
      } else if (extensions.includes(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
    
    return files;
  }
  
  return walkDir(directory);
}