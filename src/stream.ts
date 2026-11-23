// Reads a streamed answer, but gives up when it goes quiet. A connection that stays open without sending anything
// (it happens when Google's cloud is overloaded) would otherwise leave "Working in the cloud…" counting forever.
// Kept free of Firebase and the DOM so it can be tested.

export class StalledError extends Error {
  constructor(seconds: number) {
    super(`stream stalled: no new text for ${seconds} s`);
    this.name = "StalledError";
  }
}

/**
 * Yields the stream's pieces as they come. Throws StalledError if the first piece takes longer than `firstMs`, or
 * a later one longer than `nextMs`; `onStall` runs first, to cancel the request behind the stream.
 */
export async function* withStallLimit<T>(
  stream: AsyncIterable<T>,
  firstMs: number,
  nextMs: number,
  onStall: () => void = () => {},
): AsyncGenerator<T> {
  const it = stream[Symbol.asyncIterator]();
  let wait = firstMs;
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stalled = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        onStall();
        reject(new StalledError(Math.round(wait / 1000)));
      }, wait);
    });
    try {
      const next = await Promise.race([it.next(), stalled]);
      if (next.done) return;
      yield next.value;
    } finally {
      clearTimeout(timer);
    }
    wait = nextMs;
  }
}
