/**
 * Custom Hono Server for Billog Agent
 *
 * Uses @mastra/hono adapter with no /api prefix
 * Routes: /webhook/line, /uploads/*, /health
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Context } from 'hono';
import fs from 'fs/promises';
import path from 'path';

import {
  mastra,
  gateway,
  gatewayConfig,
  ensureGatewayInitialized,
  UPLOADS_DIR,
} from './mastra/index.js';

// ===========================================
// Create Hono App
// ===========================================

const app = new Hono();

// ===========================================
// Static File Serving for Uploads
// GET /uploads/*
// ===========================================

app.get('/uploads/*', async (c: Context) => {
  // Get the path after /uploads/
  const filepath = c.req.path.replace('/uploads/', '');

  // Security: prevent directory traversal
  if (!filepath || filepath.includes('..')) {
    return c.json({ error: 'Invalid path' }, 400);
  }

  const fullPath = path.join(UPLOADS_DIR, filepath);

  try {
    const file = await fs.readFile(fullPath);

    // Determine content type
    const ext = path.extname(filepath).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.pdf': 'application/pdf',
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';

    return new Response(file, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  } catch {
    return c.json({ error: 'File not found' }, 404);
  }
});

// ===========================================
// LINE Webhook Endpoint
// POST /webhook/line
// ===========================================

app.post('/webhook/line', async (c: Context) => {
  await ensureGatewayInitialized(mastra);

  const signature = c.req.header('x-line-signature') || '';
  const body = await c.req.text();

  try {
    await gateway.handleLineWebhook(JSON.parse(body), signature);
    return c.json({ success: true });
  } catch (error) {
    console.error('LINE webhook error:', error);
    return c.json({ error: 'Webhook processing failed' }, 500);
  }
});

// ===========================================
// Health Check Endpoint
// GET /health
// ===========================================

app.get('/health', (c: Context) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    adapters: {
      line: !!gatewayConfig.line,
      whatsapp: !!gatewayConfig.whatsapp,
    },
  });
});

// ===========================================
// Start Server
// ===========================================

const PORT = parseInt(process.env.PORT || '3000', 10);

console.log(`
╔═══════════════════════════════════════════════════════╗
║         Billog Agent - AI Bookkeeper                  ║
╠═══════════════════════════════════════════════════════╣
║  Routes:                                              ║
║    POST /webhook/line     LINE webhook                ║
║    GET  /uploads/*        Static file serving         ║
║    GET  /health           Health check                ║
╚═══════════════════════════════════════════════════════╝
`);

// Ensure uploads directory exists
await fs.mkdir(UPLOADS_DIR, { recursive: true });

serve({
  fetch: app.fetch,
  port: PORT,
}, (info) => {
  console.log(`✓ Server running on http://localhost:${info.port}`);
});

export default app;
