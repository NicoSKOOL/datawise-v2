export type TrafficMetricKey =
  | 'organic_etv'
  | 'organic_count'
  | 'paid_etv'
  | 'paid_count'
  | 'total_count';

export interface TrafficMetricDefinition {
  label: string;
  shortLabel: string;
  description: string;
  hint: string;
}

export const TRAFFIC_METRIC_DEFINITIONS: Record<TrafficMetricKey, TrafficMetricDefinition> = {
  organic_etv: {
    label: 'Organic ETV',
    shortLabel: 'Organic ETV',
    description: 'Estimated monthly organic visits from Google based on the target ranking keywords and expected click-through rates.',
    hint: 'Use it as a directional estimate, not a replacement for analytics sessions.',
  },
  organic_count: {
    label: 'Organic Count',
    shortLabel: 'Organic Count',
    description: 'Number of organic keywords DataForSEO found for the target in the selected location and language.',
    hint: 'Higher counts usually mean broader organic search coverage.',
  },
  paid_etv: {
    label: 'Paid ETV',
    shortLabel: 'Paid ETV',
    description: 'Estimated monthly paid-search visits from Google ads for the target in the selected market.',
    hint: 'This estimates ad traffic from visible paid rankings, not ad spend.',
  },
  paid_count: {
    label: 'Paid Count',
    shortLabel: 'Paid Count',
    description: 'Number of paid keywords DataForSEO found for the target in the selected location and language.',
    hint: 'This reflects paid search footprint for the queried market.',
  },
  total_count: {
    label: 'Total Count',
    shortLabel: 'Total Count',
    description: 'Organic Count plus Paid Count for this traffic-estimation response.',
    hint: 'This is a keyword count total, not total traffic.',
  },
};

export function isTrafficMetricKey(value: string): value is TrafficMetricKey {
  return value in TRAFFIC_METRIC_DEFINITIONS;
}
