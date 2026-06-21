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
        template:  { type: 'string', enum: ['educator', 'challenger', 'quicklist'] },
        topic:     { type: 'string' },
        category:  { type: 'string', description: 'Content category for analytics grouping, e.g. "Python Basics", "Web Concepts", "Career", "Tools"' },
        tag:       { type: 'string' },
        handle:    { type: 'string' },
        format:    { type: 'string', enum: ['post', 'story'] },
        caption:   { type: 'string', description: 'Instagram caption text — engaging hook, 2–4 sentences, no hashtags' },
        hashtags:  { type: 'string', description: 'Space-separated hashtags, e.g. "#python #coding #beginners #india"' },
        slides:    { type: 'array', minItems: 1 },
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
  "category": "string — content category for analytics, e.g. Python Basics | Web Concepts | Career | Tools",
  "tag": "string — tag label shown on cover (uppercase)",
  "handle": "string — Instagram handle without @",
  "format": "post",
  "caption": "string — Instagram caption, engaging hook in 2–4 sentences, no hashtags",
  "hashtags": "string — space-separated hashtags, e.g. #python #coding #beginners #india",
  "slides": [
    { "type": "cover", "headline": "...", "subtext": "..." },
    {
      "type": "content", "number": "01", "headline": "...",
      "body": [
        { "text": "Prose paragraph — plain sentence." }
      ]
    },
    {
      "type": "content", "number": "02", "headline": "...",
      "body": [
        { "text": "Intro sentence before the block." },
        { "kind": "block", "lines": ["INPUT:  two numbers", "PROCESSING: add them", "OUTPUT: show the sum"] },
        { "text": "Outro sentence after the block." }
      ]
    },
    {
      "type": "content", "number": "03", "headline": "...",
      "body": [
        { "kind": "code", "lines": ["def add(a, b):", "    return a + b", "", "print(add(2, 3))"] }
      ]
    },
    { "type": "cta", "headline": "...", "subline": "..." }
  ]
}

body element types:
- { "text": "..." }              — prose paragraph (DM Sans, light weight)
- { "kind": "block", "lines": [...] } — content block (monospace, light bg, saffron left border)
- { "kind": "code",  "lines": [...] } — code block (monospace, dark terminal bg, saffron left border)

Field rules:
- headline: max 8 words on cover, max 6 words on content slides
- body: array of body elements (text and/or block/code elements, in any order)
- Each body element is either { text } or { kind, lines }
- lines: string array — each element is one line; empty lines are "" array elements
- Indentation in code lines uses regular spaces
- subtext: max 12 words
- subline: max 8 words
- number: "01" to "09" as string, not integer`;

const definitions = [
  {
    name: 'draft_carousel',
    description: `Save a carousel as a draft for the user to review before PNG rendering.

ALWAYS use this tool when creating a carousel. Never render PNGs directly.
Saves the JSON to the database (status=draft), returns a /review/:id URL where
the user can see a live preview, edit the JSON, and click "Render PNG" when satisfied.
No images are created until the user confirms in the portal.
${schemaDoc}`,
    inputSchema,
  },
];

async function execute(toolName, { carousel_json }) {
  if (!carousel_json.id) carousel_json.id = uuidv4();

  const endpoint = '/api/draft';
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
