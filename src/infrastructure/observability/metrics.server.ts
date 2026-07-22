import { createServer, type Server } from 'node:http';
import type { Registry } from 'prom-client';
import { logger } from './logger.js';

export interface MetricsServerOptions {
  registry: Registry;
  port: number;
}

/**
 * Serves `/metrics` for scraping and `/health` for liveness.
 *
 * The worker has no HTTP surface of its own — it is a queue consumer — so this
 * is the only listener in the process and stays deliberately small.
 */
export function startMetricsServer({ registry, port }: MetricsServerOptions): Server {
  const server = createServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (req.url === '/metrics') {
      try {
        const body = await registry.metrics();
        res.writeHead(200, { 'content-type': registry.contentType });
        res.end(body);
      } catch (error) {
        logger.error({ error }, 'Failed to collect metrics');
        res.writeHead(500).end();
      }
      return;
    }

    res.writeHead(404).end();
  });

  server.listen(port, () => logger.info({ port }, 'Metrics server listening'));

  // A scrape endpoint must never be the reason the worker dies.
  server.on('error', (error) => logger.error({ error }, 'Metrics server error'));

  return server;
}
