/**
 * Custom Hono Server for Billog Agent
 *
 * Runs two servers:
 * - Port 3000: Custom Hono server (webhooks, uploads)
 * - Port 4111: Mastra Studio (observability UI)
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { MastraServer, type HonoBindings, type HonoVariables } from '@mastra/hono';
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
// Create Hono App with proper typing
// ===========================================

const app = new Hono<{ Bindings: HonoBindings; Variables: HonoVariables }>();

// ===========================================
// Static File Serving for Uploads
// GET /uploads/*
// ===========================================

app.get('/uploads/*', async (c: Context) => {
  const filepath = c.req.path.replace('/uploads/', '');

  if (!filepath || filepath.includes('..')) {
    return c.json({ error: 'Invalid path' }, 400);
  }

  const fullPath = path.join(UPLOADS_DIR, filepath);

  try {
    const file = await fs.readFile(fullPath);
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
// Initialize MastraServer (adds Mastra routes)
// ===========================================

const server = new MastraServer({ app, mastra });
await server.init();

// ===========================================
// Start Servers
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
║  Mastra API:                                          ║
║    GET  /api/agents       List agents                 ║
║    POST /api/agents/:id/generate   Call agent         ║
║    GET  /swagger-ui       API documentation           ║
╚═══════════════════════════════════════════════════════╝
`);

// Ensure uploads directory exists
await fs.mkdir(UPLOADS_DIR, { recursive: true });

// Start main server
serve({
  fetch: app.fetch,
  port: PORT,
}, (info) => {
  console.log(`✓ Server running on http://localhost:${info.port}`);
});

export default app;
