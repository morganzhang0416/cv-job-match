import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AiConfig } from '../../src/config.ts';

export interface ChatBody {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  response_format?: { type: string };
}

export interface MockRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  /** The JSON body that the app sent. It is empty (no messages) when the body was not JSON. */
  body: ChatBody;
}

export type MockHandler = (request: MockRequest, response: ServerResponse) => void | Promise<void>;

export interface MockAi {
  /** The address that the app would get as AI_BASE_URL. */
  baseUrl: string;
  requests: MockRequest[];
  config(overrides?: Partial<AiConfig>): AiConfig;
  close(): Promise<void>;
}

/** The body of a normal "chat completions" answer. */
export function completion(content: string): string {
  return JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] });
}

export function sendJson(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(body);
}

/** Starts a small local server that acts like an OpenAI-compatible AI service. */
export async function startMockAi(handler: MockHandler): Promise<MockAi> {
  const requests: MockRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      let body: ChatBody = { model: '', messages: [] };
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatBody;
      } catch {
        // The test can check that the body was empty.
      }
      const mock: MockRequest = { method: request.method ?? '', path: request.url ?? '', headers: request.headers, body };
      requests.push(mock);
      Promise.resolve(handler(mock, response)).catch(() => response.destroy());
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/v1`;

  return {
    baseUrl,
    requests,
    config: (overrides = {}) => ({
      provider: `127.0.0.1:${port}`,
      baseUrl,
      apiKey: 'test-key-123',
      model: 'test-model',
      jsonMode: true,
      timeoutMs: 5000,
      ...overrides,
    }),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** An address on this computer where nothing is listening, so a connection is refused. */
export async function unusedBaseUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return `http://127.0.0.1:${port}/v1`;
}

/** The data that the app put into the user message. */
export function sentData(request: MockRequest): { jobDescription: string; jobKeywords: string[]; bullets: Array<{ id: number; text: string }> } {
  const user = request.body.messages.find((message) => message.role === 'user');
  return JSON.parse(user?.content ?? '{}') as ReturnType<typeof sentData>;
}
