export function extractToolCalls(content: string): { tool: string; args: any }[] {
  const calls: { tool: string; args: any }[] = [];

  // 正規表現でツール呼び出しパターンを検索
  // パターン1: tools/call filesystem ls {"path":"/"}
  const regex1 = /tools\/call\s+(\w+)\s+(\w+)\s+({.*?})/g;
  let match: RegExpExecArray | null;

  while ((match = regex1.exec(content)) !== null) {
    try {
      const server = match[1];
      const tool = match[2];
      const argsStr = match[3];
      const fullToolName = `${server}.${tool}`;
      const args = JSON.parse(argsStr);
      calls.push({ tool: fullToolName, args });
    } catch (e) {
      // ignore malformed JSON
    }
  }

  // パターン2: tools/call ls {"path":"/"}（サーバー名なし）
  const regex2 = /tools\/call\s+(\w+)\s+({.*?})/g;

  while ((match = regex2.exec(content)) !== null) {
    const fullMatch = match[0];
    if (regex1.test(fullMatch)) continue;
    try {
      const tool = match[1];
      const argsStr = match[2];
      const args = JSON.parse(argsStr);
      calls.push({ tool, args });
    } catch (e) {
      // ignore malformed JSON
    }
  }

  return calls;
}

export function extractCodeBlocks(text: string): string[] {
  const codeBlockRegex = /```(?:javascript|js)?\n([\s\S]*?)```/g;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    blocks.push(match[1]);
  }

  return blocks;
}
