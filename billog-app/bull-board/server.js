import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Queue } from 'bullmq';

// Parse Redis URL
function getRedisConnection() {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const url = new URL(redisUrl);
    const isTls = url.protocol === 'rediss:';
    return {
      host: url.hostname,
      port: parseInt(url.port || '6379', 10),
      password: url.password ? decodeURIComponent(url.password) : undefined,
      tls: isTls ? {} : undefined,
    };
  }
  return {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  };
}

const connection = getRedisConnection();

// Create queues
const messageQueue = new Queue('message-queue', { connection });
const summaryQueue = new Queue('summary-queue', { connection });

// Setup Bull Board
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/');

createBullBoard({
  queues: [
    new BullMQAdapter(messageQueue),
    new BullMQAdapter(summaryQueue),
  ],
  serverAdapter,
});

const app = express();
app.use('/', serverAdapter.getRouter());

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`Bull Board running on http://localhost:${port}`);
  console.log(`Connected to Redis: ${connection.host}:${connection.port}`);
});
