import { ConfigService } from '@nestjs/config';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatModelService } from './chat-model.service';
import { AnswerGenerationService } from './answer-generation.service';
import { AnswerPromptService } from './answer-prompt.service';
import { source, answerOutput } from './answer.fixture';

const servers: Server[] = [];
const requests: Array<{ path: string; auth: string | undefined; body: any }> =
  [];
const completion = (content: string | null, finish = 'stop') => ({
  id: 'completion-test',
  object: 'chat.completion',
  created: 1,
  model: 'configured-deepseek-model',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: finish,
    },
  ],
  usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
});

async function startApi(responses: Array<{ status?: number; body: unknown }>) {
  const server = createServer(async (req, res) => {
    let data = '';
    for await (const chunk of req) data += chunk;
    requests.push({
      path: req.url ?? '',
      auth: req.headers.authorization,
      body: JSON.parse(data),
    });
    const response = responses.shift() ?? {
      status: 500,
      body: { error: { message: 'No more responses' } },
    };
    res.writeHead(response.status ?? 200, {
      'Content-Type': 'application/json',
    });
    res.end(JSON.stringify(response.body));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`;
}

function config(baseURL: string, extra: Record<string, string> = {}) {
  return new ConfigService({
    DEEPSEEK_API_KEY: 'local-test-key',
    DEEPSEEK_BASE_URL: baseURL,
    ...extra,
  });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
  requests.length = 0;
});

describe('DeepSeek answer provider over the actual OpenAI-compatible transport', () => {
  it('uses the configured Base URL and key, selects DeepSeek by default, and sends only answer parameters', async () => {
    const baseURL = await startApi([{ body: completion('需审批 [S1]') }]);
    const service = new ChatModelService(config(baseURL));
    expect(service.modelName).toBe('deepseek-v4-pro');
    expect(await service.generate('问题及上下文')).toBe('需审批 [S1]');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      path: '/v1/chat/completions',
      auth: 'Bearer local-test-key',
      body: {
        model: 'deepseek-v4-pro',
        max_tokens: 4096,
        temperature: 0,
        thinking: { type: 'disabled' },
        stream: false,
        messages: [{ role: 'user', content: '问题及上下文' }],
      },
    });
    expect(requests[0].body).not.toHaveProperty('num_ctx');
    expect(requests[0].body).not.toHaveProperty('num_predict');
    expect(requests[0].body).not.toHaveProperty('seed');
  });

  it('honors the configured model and retains source validation and a single citation repair', async () => {
    const baseURL = await startApi([
      { body: completion('需要审批。') },
      { body: completion(answerOutput('需要审批。', '申请需要审批。')) },
    ]);
    const model = new ChatModelService(
      config(baseURL, { DEEPSEEK_MODEL: 'configured-deepseek-model' }),
    );
    const prompts = new AnswerPromptService();
    const items = [source('a', '申请需要审批。')];
    const result = await new AnswerGenerationService(model, prompts).generate(
      prompts.build('申请条件？', items),
      items,
    );
    expect(result).toMatchObject({
      modelName: 'configured-deepseek-model',
      sourceIds: ['S1'],
      outcome: 'answered',
    });
    expect(requests).toHaveLength(2);
    expect(
      requests.every((r) => r.body.model === 'configured-deepseek-model'),
    ).toBe(true);
    expect(requests[1].body.messages[0].content).toContain(
      '未通过结构与证据校验',
    );
  });

  it.each([401, 429, 500])(
    'surfaces HTTP %s once without automatic transport retries or a local fallback',
    async (status) => {
      const baseURL = await startApi([
        {
          status,
          body: {
            error: { message: 'provider unavailable', type: 'api_error' },
          },
        },
      ]);
      const model = new ChatModelService(config(baseURL));
      await expect(model.generate('prompt')).rejects.toThrow();
      expect(requests).toHaveLength(1);
    },
  );

  it.each(['length', 'content_filter', 'tool_calls'])(
    'rejects incomplete or non-answer completions: %s',
    async (reason) => {
      const baseURL = await startApi([
        { body: completion('prefix [S1]', reason) },
      ]);
      await expect(
        new ChatModelService(config(baseURL)).generate('prompt'),
      ).rejects.toThrow();
      expect(requests).toHaveLength(1);
    },
  );

  it('rejects empty final content instead of presenting reasoning as an answer', async () => {
    const response = completion(null);
    Object.assign(response.choices[0].message, {
      reasoning_content: 'private reasoning [S1]',
    });
    const baseURL = await startApi([{ body: response }]);
    await expect(
      new ChatModelService(config(baseURL)).generate('prompt'),
    ).rejects.toThrow('empty answer');
  });

  it.each([
    '',
    'not-a-url',
    'file:///tmp/key',
    'https://user:password@example.com',
    'https://example.com?key=value',
    'https://example.com#key',
  ])(
    'rejects invalid Base URLs without including their values in errors: %s',
    (baseURL) => {
      expect(() => new ChatModelService(config(baseURL))).toThrow(
        /DEEPSEEK_BASE_URL must be an HTTP\(S\) URL/,
      );
    },
  );

  it('rejects an empty configured model', () => {
    expect(
      () =>
        new ChatModelService(
          config('https://api.deepseek.com', { DEEPSEEK_MODEL: ' ' }),
        ),
    ).toThrow('DEEPSEEK_MODEL must not be empty');
  });
});
