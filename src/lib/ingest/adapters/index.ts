import type { WebhookSourceType } from '@/lib/db/schema/webhook-sources';
import type { Adapter } from '../types';
import { genericAdapter } from './generic';
import { sentryAdapter } from './sentry';
import { datadogAdapter } from './datadog';
import { grafanaAdapter } from './grafana';

const REGISTRY: Record<WebhookSourceType, Adapter> = {
  generic: genericAdapter,
  sentry: sentryAdapter,
  datadog: datadogAdapter,
  grafana: grafanaAdapter,
};

export function getAdapter(type: WebhookSourceType): Adapter {
  return REGISTRY[type];
}

export { genericAdapter, sentryAdapter, datadogAdapter, grafanaAdapter };
