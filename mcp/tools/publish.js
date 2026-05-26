'use strict';

const BASE_URL = () => (process.env.NODE_APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const definitions = [
  {
    name: 'schedule_post',
    description: 'Schedule a carousel post to publish automatically at a future time. The server scheduler checks every 60 seconds and publishes when the time arrives. The server must be running.',
    inputSchema: {
      type: 'object',
      properties: {
        id:           { type: 'string', description: 'Post ID to schedule' },
        iso_datetime: { type: 'string', description: 'ISO 8601 datetime string for publish time. Must be at least 10 minutes in the future. Example: 2026-05-20T14:00:00+05:30' },
      },
      required: ['id', 'iso_datetime'],
    },
  },
];

async function execute(toolName, args) {
  if (toolName === 'schedule_post') {
    const res = await fetch(`${BASE_URL()}/api/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: args.id, iso_datetime: args.iso_datetime }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Server error ${res.status}`);
    return data;
  }
}

module.exports = { definitions, execute };
