/** One process-wide parser budget. Waiting callers do not submit remote work. */
export class ParseCapacity {
  private running = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly limit: number) {}

  async run<T>(
    signal: AbortSignal | undefined,
    work: () => Promise<T>,
  ): Promise<T> {
    signal?.throwIfAborted();
    if (this.running < this.limit) this.running++;
    else
      await new Promise<void>((resolve, reject) => {
        const resume = () => {
          signal?.removeEventListener('abort', cancel);
          resolve();
        };
        const cancel = () => {
          const index = this.waiting.indexOf(resume);
          if (index < 0) return;
          this.waiting.splice(index, 1);
          signal?.removeEventListener('abort', cancel);
          reject(signal?.reason ?? new Error('Parsing canceled while waiting'));
        };
        this.waiting.push(resume);
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
      });
    try {
      signal?.throwIfAborted();
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.running--;
    }
  }
}
