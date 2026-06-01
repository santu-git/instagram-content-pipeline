'use strict';

const BASE_URL = () => (process.env.NODE_APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const definitions = [
  {
    name: 'get_post_stats',
    description: 'Fetch fresh performance stats from Instagram for a published post and store them in the database. Returns topic, template, category, slide metadata, and all engagement metrics so you can analyze what worked.',
    inputSchema: {
      type: 'object',
      properties: {
        post_id: { type: 'string', description: 'Pipeline post ID (local UUID)' },
      },
      required: ['post_id'],
    },
  },
  {
    name: 'get_weekly_summary',
    description: 'Get aggregated performance summary for posts published in the last N days (default 7). Returns per-post stats plus totals and the top-performing post. Use this to analyze what content resonated and recommend next week\'s topics.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Look-back window in days (default: 7)' },
      },
    },
  },
];

async function execute(toolName, args) {
  if (toolName === 'get_post_stats') {
    const res = await fetch(`${BASE_URL()}/api/stats/${args.post_id}`);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Server error ${res.status}`);
    return data;
  }

  if (toolName === 'get_weekly_summary') {
    const days = args.days || 7;
    const res = await fetch(`${BASE_URL()}/api/weekly-summary?days=${days}`);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Server error ${res.status}`);
    return data;
  }
}

module.exports = { definitions, execute };
