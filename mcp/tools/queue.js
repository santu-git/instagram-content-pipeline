'use strict';

const BASE_URL = () => (process.env.NODE_APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const definitions = [
  {
    name: 'list_scheduled_posts',
    description: 'List all posts currently scheduled to publish on Instagram, ordered by scheduled time.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cancel_scheduled_post',
    description: 'Cancel a scheduled post. Deletes the Instagram container and marks the post as cancelled in the database.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Post ID to cancel (the local pipeline ID, not the Instagram container ID)' },
      },
      required: ['id'],
    },
  },
];

async function execute(toolName, args) {
  if (toolName === 'list_scheduled_posts') {
    const res = await fetch(`${BASE_URL()}/api/scheduled-posts`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
    return data;
  }

  if (toolName === 'cancel_scheduled_post') {
    const res = await fetch(`${BASE_URL()}/api/schedule/${args.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `Server error ${res.status}`);
    return data;
  }
}

module.exports = { definitions, execute };
