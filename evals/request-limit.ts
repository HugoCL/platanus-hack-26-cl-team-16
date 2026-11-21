export function createRequestLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("request limit must be a positive integer");
  }
  let active = 0;
  const waiting: { weight: number; start: () => void }[] = [];
  function drain() {
    while (waiting.length > 0 && active + waiting[0].weight <= limit) {
      waiting.shift()?.start();
    }
  }
  return async function run<T>(
    request: () => Promise<T>,
    weight = 1,
  ): Promise<T> {
    if (!Number.isInteger(weight) || weight < 1 || weight > limit) {
      throw new Error(
        "request weight must be a positive integer within the limit",
      );
    }
    await new Promise<void>((resolve) => {
      const start = () => {
        active += weight;
        resolve();
      };
      waiting.push({ weight, start });
      drain();
    });
    try {
      return await request();
    } finally {
      active -= weight;
      drain();
    }
  };
}
