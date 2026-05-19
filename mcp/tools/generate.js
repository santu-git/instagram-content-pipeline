'use strict';

const { v4: uuidv4 } = require('uuid');

const BASE_URL = () => (process.env.NODE_APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const definition = {
  name: 'generate_carousel',
  description: `Render and upload an Instagram carousel post.

Claude generates the carousel JSON following the schema below, then calls this tool.
The tool renders PNGs, uploads to DigitalOcean Spaces, saves to DB, and returns a preview URL.

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
    { "type": "cta", "headline": "...", "subline": "..." }
  ]
}

Field rules:
- headline: max 8 words on cover, max 6 words on content slides
- body: max 30 words
- subtext: max 12 words
- subline: max 8 words
- number: "01" to "09" as string, not integer`,

  inputSchema: {
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
  },
};

async function execute({ carousel_json }) {
  if (!carousel_json.id) carousel_json.id = uuidv4();

  const res = await fetch(`${BASE_URL()}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(carousel_json),
  });

  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `Server error ${res.status}`);

  return data;
}

module.exports = { definition, execute };
