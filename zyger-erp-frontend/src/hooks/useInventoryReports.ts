import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { inventoryReportsService } from '../services/inventoryReportsService';
import type { ReportQueryParams } from '../types/inventory/reports.types';

export function useReportsOverview(fromDate: string, toDate: string) {
  return useQuery({
    queryKey: ['inventory-reports', 'overview', fromDate, toDate],
    queryFn: ({ signal }) =>
      inventoryReportsService.getOverview({ fromDate, toDate }, signal),
    staleTime: 1000 * 30,
    retry: 1,
  });
}

export function useStockLedger(params: ReportQueryParams) {
  return useQuery({
    queryKey: ['inventory-reports', 'stock-ledger', params],
    queryFn: ({ signal }) =>
      inventoryReportsService.getStockLedger(params, signal),
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: 1,
  });
}

export function useCurrentStock(params: ReportQueryParams) {
  return useQuery({
    queryKey: ['inventory-reports', 'current-stock', params],
    queryFn: ({ signal }) =>
      inventoryReportsService.getCurrentStock(params, signal),
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: 1,
  });
}

export function useStoreStock(params: ReportQueryParams) {
  return useQuery({
    queryKey: ['inventory-reports', 'store-stock', params],
    queryFn: ({ signal }) =>
      inventoryReportsService.getStoreStock(params, signal),
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: 1,
  });
}

export function useDrilldown(type: string, params: ReportQueryParams) {
  return useQuery({
    queryKey: ['inventory-reports', 'drilldown', type, params],
    queryFn: ({ signal }) =>
      inventoryReportsService.getDrilldown(type, params, signal),
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: 1,
  });
}

export function useStockSummary() {
  return useQuery({
    queryKey: ['inventory-reports', 'stock-summary'],
    queryFn: ({ signal }) => inventoryReportsService.getStockSummary(signal),
    staleTime: 1000 * 30,
    retry: 1,
  });
}

export function useSimpleReport() {
  return useQuery({
    queryKey: ['inventory-reports', 'simple'],
    queryFn: ({ signal }) => inventoryReportsService.getSimple(signal),
    staleTime: 1000 * 30,
    retry: 1,
  });
}