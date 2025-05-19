import assert from 'node:assert/strict';
import { extractToolCalls, extractCodeBlocks } from '../dist/utils/extract.js';
import test from 'node:test';

// Tests for extractToolCalls pattern with server and tool
test('extractToolCalls with server prefix', () => {
  const input = 'prefix\ntools/call filesystem ls {"path":"/"}\n';
  assert.deepStrictEqual(
    extractToolCalls(input),
    [{ tool: 'filesystem.ls', args: { path: '/' } }]
  );
});

// Tests for extractToolCalls pattern without server
test('extractToolCalls without server prefix', () => {
  const input = 'tools/call ls {"path":"/"}';
  assert.deepStrictEqual(
    extractToolCalls(input),
    [{ tool: 'ls', args: { path: '/' } }]
  );
});

// Tests for extractCodeBlocks
test('extractCodeBlocks returns contents of code blocks', () => {
  const input = `Text before\n\n\`\`\`js\nconsole.log('hi');\n\`\`\`\n\nMore text\n\n\`\`\`\nplain code\n\`\`\``;
  assert.deepStrictEqual(
    extractCodeBlocks(input),
    ["console.log('hi');\n", 'plain code\n']
  );
});
