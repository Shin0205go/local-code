/**
 * マークダウンからコードブロックを抽出
 */
export function extractCodeBlocks(text: string): string[] {
  const codeBlockRegex = /```(?:javascript|js)?\n([\s\S]*?)```/g;
  const blocks: string[] = [];
  let match;
  
  while ((match = codeBlockRegex.exec(text)) !== null) {
    blocks.push(match[1]);
  }
  
  return blocks;
}