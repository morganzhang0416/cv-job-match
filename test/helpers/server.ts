import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp, type AppOptions } from '../../src/app.ts';
import type { AppConfig } from '../../src/config.ts';

export interface TestServer {
  /** For example "http://127.0.0.1:41234". */
  url: string;
  /** The lines that the app wrote to its log. */
  logs: string[];
  close(): Promise<void>;
}

export const BASE_CONFIG: AppConfig = { host: '127.0.0.1', port: 0, trustProxy: false, ai: null, warnings: [] };

type ServerOptions = Partial<Omit<AppOptions, 'config'>> & { config?: Partial<AppConfig> };

/** Starts the real app on a free port of this computer. */
export async function startServer(options: ServerOptions = {}): Promise<TestServer> {
  const logs: string[] = [];
  const { config, ...rest } = options;
  // The limit is high so that it does not get in the way. The tests of the limit set their own.
  const app = createApp({ log: (line) => logs.push(line), rateLimit: { max: 100_000, windowMs: 600_000 }, ...rest, config: { ...BASE_CONFIG, ...config } });
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    logs,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
