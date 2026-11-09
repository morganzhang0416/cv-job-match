import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
for (const warning of config.warnings) console.warn(`Warning: ${warning}`);

const server = createServer(createApp({ config }));

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. Pick another one, for example: PORT=${config.port + 1}`);
  } else if (error.code === 'EACCES') {
    console.error(`This account may not listen on port ${config.port}. Pick a port above 1024.`);
  } else {
    console.error(`The server could not start (${error.code ?? error.name}).`);
  }
  process.exit(1);
});

/** The address to show. "0.0.0.0" and "::" mean "all addresses", and a browser needs "localhost" for them. */
function shownHost(host: string): string {
  if (host === '0.0.0.0' || host === '::') return 'localhost';
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

server.listen(config.port, config.host, () => {
  const { port } = server.address() as AddressInfo;
  console.log(`Resume and job match analyzer: http://${shownHost(config.host)}:${port}`);
  console.log(
    config.ai
      ? `AI rewrites: on (${config.ai.provider}, model ${config.ai.model})`
      : 'AI rewrites: off. The tool gives built-in suggestions only. The README shows how to turn AI on.',
  );
});

function shutdown(): void {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  // A running request may keep the server open. Stop it after a few seconds.
  setTimeout(() => {
    server.closeAllConnections();
  }, 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
