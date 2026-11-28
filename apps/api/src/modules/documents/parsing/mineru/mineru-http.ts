import { setTimeout as delay } from 'node:timers/promises';
import { mineruOptions } from './mineru-options';

type Options = ReturnType<typeof mineruOptions>;

export class MineruHttp {
  constructor(private readonly options: Options) {}

  async request(
    url: string,
    init: RequestInit,
    signal: AbortSignal,
    maxBytes = this.options.maxBytes,
  ): Promise<Buffer> {
    const target = new URL(url);
    const origin = new URL(this.options.base).origin;
    if (
      !['http:', 'https:'].includes(target.protocol) ||
      target.username ||
      target.password ||
      (target.origin !== origin &&
        !this.options.origins.includes(target.origin))
    )
      throw new Error('MinerU returned an unapproved transfer origin');
    const headers = new Headers(init.headers);
    headers.delete('authorization');
    if (target.origin === origin && this.options.key)
      headers.set('Authorization', `Bearer ${this.options.key}`);
    // Do not forward credentials through redirects or automatically fetch arbitrary origins.
    const response = await fetch(target, {
      ...init,
      headers,
      signal,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`MinerU HTTP ${response.status}`);
    }
    if (Number(response.headers.get('content-length') || 0) > maxBytes) {
      await response.body?.cancel();
      throw new Error('MinerU response exceeds byte budget');
    }
    const parts: Uint8Array[] = [];
    let size = 0;
    const reader = response.body?.getReader();
    try {
      if (reader)
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > maxBytes)
            throw new Error('MinerU response exceeds byte budget');
          parts.push(value);
        }
    } finally {
      await reader?.cancel();
    }
    return Buffer.concat(parts);
  }

  async json(
    path: string,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<any> {
    const bytes = await this.request(
      `${this.options.base}${path}`,
      init,
      signal,
      2 * 1024 * 1024,
    );
    try {
      return JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new Error('MinerU returned invalid JSON');
    }
  }

  async result(
    taskId: string,
    signal: AbortSignal,
    progress?: (stage: string) => Promise<void>,
  ): Promise<Buffer> {
    while (true) {
      const snapshot = await this.json(
        `/v1/tasks/${encodeURIComponent(taskId)}`,
        {},
        signal,
      );
      if (!Array.isArray(snapshot.files) || snapshot.files.length !== 1)
        throw new Error('Invalid MinerU task file count');
      const file = snapshot.files[0];
      if (file.status === 'completed') {
        if (typeof file.result_url !== 'string')
          throw new Error('Missing MinerU result URL');
        return this.request(file.result_url, {}, signal);
      }
      if (
        ['failed', 'canceled'].includes(file.status) ||
        ['failed', 'canceled'].includes(snapshot.status)
      )
        throw new Error(
          `MinerU task ${file.status === 'canceled' ? 'canceled' : 'failed'}`,
        );
      if (!['waiting-file', 'pending', 'running'].includes(file.status))
        throw new Error('Invalid MinerU task state');
      await progress?.(
        file.status === 'running' ? 'parsing' : 'waiting-parser',
      );
      await delay(this.options.pollMs, undefined, { signal });
    }
  }
}
