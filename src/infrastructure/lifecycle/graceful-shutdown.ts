import { logger } from '../observability/logger.js';

export interface ShutdownStep {
  name: string;
  run: () => Promise<void> | void;
}

export interface ShutdownOptions {
  /** Run in order, each awaited before the next starts. */
  steps: ShutdownStep[];
  /** Hard limit on the whole sequence; past it the process exits with code 1. */
  timeoutMs: number;
  /** Injectable so tests can observe the exit code. */
  exit?: (code: number) => void;
}

/**
 * Builds the handler for termination signals.
 *
 * Only the first signal counts. A failing step is logged and the rest still
 * run, so one bad teardown cannot leave the others undone. The timeout exists
 * because a process that hangs here gets killed anyway, without the log line.
 */
export function createShutdown(options: ShutdownOptions): (signal: string) => Promise<void> {
  const { steps, timeoutMs, exit = process.exit } = options;
  let started = false;

  return async (signal) => {
    if (started) return;
    started = true;

    logger.info({ signal }, 'Shutting down');

    const timer = setTimeout(() => {
      logger.error({ timeoutMs }, 'Shutdown timed out, forcing exit');
      exit(1);
    }, timeoutMs);

    let failed = false;
    for (const step of steps) {
      try {
        await step.run();
      } catch (error) {
        failed = true;
        logger.error({ error, step: step.name }, 'Shutdown step failed');
      }
    }

    clearTimeout(timer);
    logger.info('Shutdown complete');
    exit(failed ? 1 : 0);
  };
}
