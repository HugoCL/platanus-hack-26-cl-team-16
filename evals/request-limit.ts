export function createRequestLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("request limit must be a positive integer");
  }
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(request: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      const start = () => {
        active++;
        resolve();
      };
      if (active < limit) start();
      else waiting.push(start);
    });
    try {
      return await request();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}
