'use strict';

const BASE_URL = () => (process.env.NODE_APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const definition = {
  name: 'preview_carousel',
  description: 'Get the preview URL and current status of a carousel post by its ID.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Post ID returned by generate_carousel' },
    },
    required: ['id'],
  },
};

async function execute({ id }) {
  const res = await fetch(`${BASE_URL()}/api/post/${id}`);
  const data = await res.json();

  if (res.status === 404 || data.error) throw new Error(data.error || `Post "${id}" not found`);

  return {
    id: data.id,
    preview_url: `${BASE_URL()}/preview/${id}`,
    slide_count: (data.image_urls || []).length,
    template: data.template,
    status: data.status,
    topic: data.topic,
  };
}

module.exports = { definition, execute };
