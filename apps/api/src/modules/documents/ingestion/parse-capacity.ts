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
    else await new Promise<void>((resolve) => this.waiting.push(resolve));
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
