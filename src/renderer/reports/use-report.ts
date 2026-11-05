// The active report's query (15 §7, 03 §8): only the active tab is requested, with its effective committed
// filters and options; drafts never reach the key. The key starts with the `reports` root, so the tables a
// report reads refresh it (03 §4.1). While a refetch runs, the last result of the same report stays shown.
import { today as todayOf } from '@shared/dates';
import type { ReportPage, ReportRequest } from '@shared/reporting/model';
import type { ReportResult } from '@shared/reporting/result';
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import { weekStartsOn } from '../i18n';
import { host } from '../rpc/host-client';
import { useConnection } from '../stores/connection';
import { useReportsView } from './state';

/** A page's request from the view state. */
export function requestFor(
  page: ReportPage,
  view: ReturnType<typeof useReportsView>,
  clock: Pick<ReportRequest, 'today' | 'weekStart'>,
): ReportRequest {
  const filters = view.filtersOf(page);
  switch (page) {
    case 'breakdown':
      return { ...clock, kind: page, filters, options: { ...view.breakdown } };
    case 'comparison':
      return {
        ...clock,
        kind: page,
        filters: {
          categories: filters.categories,
          payees: filters.payees,
          accounts: filters.accounts,
        },
        options: { ...view.comparison },
      };
    case 'netWorth':
      return {
        ...clock,
        kind: page,
        filters: { timeframe: filters.timeframe, accounts: filters.accounts },
      };
    default:
      return { ...clock, kind: page, filters };
  }
}

export function useActiveReport() {
  const view = useReportsView();
  const connection = useConnection();
  // Plain data: the request crosses the host port, which can't clone the store's reactive proxies.
  const request = computed(
    () =>
      JSON.parse(
        JSON.stringify(
          requestFor(view.tab, view, { today: todayOf(new Date()), weekStart: weekStartsOn.value }),
        ),
      ) as ReportRequest,
  );
  return useQuery(
    computed(() => ({
      queryKey: ['reports', request.value] as const,
      queryFn: (): Promise<ReportResult> => host.call('reports.get', request.value),
      enabled: connection.info.budget !== null,
      // Only a previous result of the same report stands in while the new one loads.
      placeholderData: (previous: ReportResult | undefined) =>
        previous?.kind === request.value.kind ? previous : undefined,
    })),
  );
}
