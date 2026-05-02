// Phase 2: Upload rendered PNGs to DigitalOcean Spaces
// Usage: node scripts/upload.js --input output/posts/{id}/
// Returns: public CDN URLs for each uploaded PNG

'use strict';

// TODO: implement in Phase 2
// - Accept --input folder path via CLI args
// - Load DO_SPACES_* credentials from .env
// - Upload each PNG to Spaces under posts/{id}/ prefix
// - Return public CDN URLs mapped to slide filenames
// - Delete local output folder after successful upload
