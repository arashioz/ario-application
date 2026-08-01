import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { connectDatabase } from './config/database';
import routes from './routes';
import { setupWebSocket } from './websocket/handler';
import { getPublicCatalog } from './services/productService';

const PORT = parseInt(process.env.PORT || '3001', 10);
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/ario-shop';
const WS_PATH = process.env.WS_PATH || '/ws';

async function main() {
  await connectDatabase(MONGODB_URI);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '6mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  app.get('/api/public/catalog', async (_req, res) => {
    try {
      res.json(await getPublicCatalog());
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : 'error' });
    }
  });

  app.use('/api', routes);

  const server = http.createServer(app);
  setupWebSocket(server, WS_PATH);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
    console.log(`🔌 WebSocket on ws://0.0.0.0:${PORT}${WS_PATH}`);
  });
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
