export class NotConfiguredError extends Error {
  readonly code = 'NOT_CONFIGURED' as const;

  constructor(port: string, method: string) {
    super(`${port}.${method} is not configured`);
    this.name = 'NotConfiguredError';
  }
}
