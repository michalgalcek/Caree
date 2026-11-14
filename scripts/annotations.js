// Generates docs/TOOL_ANNOTATIONS.md from the live tool definitions (keeps the OpenAI form answers in sync with the code).
import { writeFileSync } from 'node:fs';
import { buildMcpServer, TOOL_ANNOTATION_NOTES } from '../src/mcp.js';
import { Caree } from '../src/services.js';
import { openDb } from '../src/db.js';
buildMcpServer(new Caree(openDb()), { baseUrl: 'https://example' });
const b = (v) => (v ? 'true' : 'false');
const rows = Object.entries(TOOL_ANNOTATION_NOTES).map(([n, t]) => `| \`${n}\` | ${t.title} | ${b(t.annotations.readOnlyHint)} | ${b(t.annotations.destructiveHint)} | ${b(t.annotations.openWorldHint)} | ${t.why} |`);
writeFileSync('docs/TOOL_ANNOTATIONS.md', `# Tool annotations – justification for the OpenAI review form\n\nGenerated from the code (\`npm run annotations\`). Every tool sets all three hints explicitly.\n\n| Tool | Title | readOnly | destructive | openWorld | Justification |\n|---|---|---|---|---|---|\n${rows.join('\n')}\n`);
console.log(`${rows.length} tools documented`);
