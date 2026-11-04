import { Injectable } from '@nestjs/common';
import { parseApiEnv, type ApiEnv } from './env';
import './load-env';

@Injectable()
export class AppConfig {
  readonly env: ApiEnv;

  constructor() {
    this.env = parseApiEnv(process.env);
  }
}
