// Phase 3: MCP Server — runs on Mac, bridges Claude Desktop to Node app on Droplet
// Config location: ~/Library/Application Support/Claude/claude_desktop_config.json
// No Claude API key required — uses Claude Desktop subscription via MCP protocol

'use strict';

// TODO: implement in Phase 3
// - Initialise @modelcontextprotocol/sdk MCP server
// - Register all tools from mcp/tools/
// - Each tool makes HTTP calls to NODE_APP_BASE_URL (Droplet) via fetch
// - Tools: generate_carousel, preview_carousel, publish_now, schedule_post,
//          list_scheduled_posts, cancel_scheduled_post, get_post_stats, get_weekly_summary
