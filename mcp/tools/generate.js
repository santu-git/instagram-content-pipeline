'use strict';

const { v4: uuidv4 } = require('uuid');

const BASE_URL = () => (process.env.NODE_APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const inputSchema = {
  type: 'object',
  properties: {
    carousel_json: {
      type: 'object',
      description: 'Full carousel JSON following the schema in the tool description',
      properties: {
        template: { type: 'string', enum: ['educator', 'challenger', 'quicklist'] },
        topic:    { type: 'string' },
        tag:      { type: 'string' },
        handle:   { type: 'string' },
        format:   { type: 'string', enum: ['post', 'story'] },
        slides:   { type: 'array', minItems: 1 },
      },
      required: ['template', 'slides'],
    },
  },
  required: ['carousel_json'],
};

const schemaDoc = `
JSON schema:
{
  "template": "educator | challenger | quicklist",
  "topic": "string — the post topic",
  "tag": "string — tag label shown on cover (uppercase)",
  "handle": "string — Instagram handle without @",
  "format": "post",
  "slides": [
    { "type": "cover", "headline": "...", "subtext": "..." },
    { "type": "content", "number": "01", "headline": "...", "body": "..." },
    { "type": "content", "number": "02", "headline": "...", "body_type": "block", "body_lines": ["INPUT:  ...", "PROCESSING: ...", "OUTPUT: ..."] },
    { "type": "content", "number": "03", "headline": "...", "body_type": "code",  "body_lines": ["def foo():", "    return 1", "", "foo()"] },
    { "type": "cta", "headline": "...", "subline": "..." }
  ]
}

Field rules:
- headline: max 8 words on cover, max 6 words on content slides
- body: max 30 words — plain prose string
- body_lines: string array — use INSTEAD of body for structured/code content; each element is one line
- body_type: required when body_lines is present — "block" (process flow, light bg) or "code" (actual code, dark terminal bg)
- Use either body OR body_lines+body_type on a content slide, never both
- Indentation in code lines uses regular spaces; empty lines are "" array elements
- subtext: max 12 words
- subline: max 8 words
- number: "01" to "09" as string, not integer`;

const definitions = [
  {
    name: 'generate_carousel',
    description: `Render and upload an Instagram carousel post immediately.

Claude generates the carousel JSON, then calls this tool.
The tool renders PNGs, uploads to DigitalOcean Spaces, saves to DB, and returns a preview URL.
Use this when the user wants to go straight to review without editing the JSON first.
${schemaDoc}`,
    inputSchema,
  },
  {
    name: 'draft_carousel',
    description: `Save a carousel as a draft for review and editing before PNG generation.

Use this instead of generate_carousel when the user wants to inspect or edit
the JSON in the portal before committing to rendering. Returns a preview_url
where the user can edit the JSON and see a live slide preview, then click
"Render PNG" when satisfied. No images are created until the user renders.
${schemaDoc}`,
    inputSchema,
  },
];

async function execute(toolName, { carousel_json }) {
  if (!carousel_json.id) carousel_json.id = uuidv4();

  const endpoint = toolName === 'draft_carousel' ? '/api/draft' : '/api/generate';
  const res = await fetch(`${BASE_URL()}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(carousel_json),
  });

  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `Server error ${res.status}`);

  return data;
}

module.exports = { definitions, execute };
