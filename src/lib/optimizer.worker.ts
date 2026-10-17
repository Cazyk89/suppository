/// <reference lib="webworker" />
import type { OptimizeInput } from './optimizer';
import { optimize } from './optimizer';

self.onmessage = (e: MessageEvent<OptimizeInput>) => {
  try {
    const result = optimize(e.data, (fraction, message) => self.postMessage({ type: 'progress', fraction, message }));
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error).message });
  }
};
