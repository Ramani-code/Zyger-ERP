import apiClient from '../api/axiosClient';
import { printDocument as printDoc } from '../utils/printDocument';
import type { PageDto } from '../types/api.types';
import type {
  IdleTimeEntry,
  JobCard,
  JobCardSubjob,
  ProductConversion,
  ProductionActionPayload,
  ProductionDashboardSummary,
  ProductionEntry,
  ProductionEntryLinePayload,
  ProductionLogActivity,
  ProductionLogSheet,
  ProductionOrder,
  ProductionPage,
  ProductionPendingRow,
  ProductionReturn,
} from '../types/production/production.types';

/**
 * Production module API layer (DOC 18 P1; DOC 13 API spec).
 *
 * Endpoint paths are centralized here. The controller base is
 * {@code /api/v1/production} (see backend ProductionController). Envelope +
 * pagination are auto-unwrapped by {@link apiClient} (FRS §5.1).
 *
 * P1 scope: this is the foundational service layer. Screens are NOT refactored to
 * consume it in P1 (that is P5+); this layer is additive and ready for later wiring.
 */
const PRODUCTION_BASE = '/v1/production';

const ENDPOINTS = {
  jobCards: `${PRODUCTION_BASE}/job-cards`,
  entries: `${PRODUCTION_BASE}/entries`,
  conversions: `${PRODUCTION_BASE}/conversions`,
  returns: `${PRODUCTION_BASE}/returns`,
  logSheets: `${PRODUCTION_BASE}/log-sheets`,
  idleTime: `${PRODUCTION_BASE}/idle-time`,
  pending: `${PRODUCTION_BASE}/pending`,
  dashboard: `${PRODUCTION_BASE}/dashboard`,
  toolLife: `${PRODUCTION_BASE}/tool-life`,
} as const;

export const productionApi = {
  // ─── Production Order (canonical work_order) ────────────────────────────
  async listOrders(params: ProductionPageParams, signal?: AbortSignal): Promise<ProductionPage<ProductionOrder>> {
    const response = await apiClient.get<PageDto<ProductionOrder>>(`${PRODUCTION_BASE}/orders`, {
      params: toParams(params),
      signal,
    });
    return response.data;
  },

  async getOrder(id: number | string, signal?: AbortSignal): Promise<ProductionOrder> {
    const response = await apiClient.get<ProductionOrder>(`${PRODUCTION_BASE}/orders/${id}`, { signal });
    return response.data;
  },

  async createOrder(payload: Record<string, unknown>): Promise<ProductionOrder> {
    const response = await apiClient.post<ProductionOrder>(`${PRODUCTION_BASE}/orders`, payload);
    return response.data;
  },

  async updateOrder(id: number | string, payload: Record<string, unknown>): Promise<ProductionOrder> {
    const response = await apiClient.put<ProductionOrder>(`${PRODUCTION_BASE}/orders/${id}`, payload);
    return response.data;
  },

  async deleteOrder(id: number | string): Promise<void> {
    await apiClient.delete(`${PRODUCTION_BASE}/orders/${id}`);
  },

  async nextOrderNumber(): Promise<{ nextNumber: string }> {
    const response = await apiClient.get<{ nextNumber: string }>(`${PRODUCTION_BASE}/orders/next-number`);
    return response.data;
  },

  async orderAction(id: number | string, action: string, payload: Partial<ProductionActionPayload> = {}): Promise<unknown> {
    const response = await apiClient.post(`${PRODUCTION_BASE}/orders/${id}/actions/${action}`, {
      note: payload.note ?? '',
      qty: payload.qty,
    });
    return response.data;
  },

  async populateOrder(id: number | string): Promise<unknown> {
    const response = await apiClient.post(`${PRODUCTION_BASE}/orders/${id}/populate`);
    return response.data;
  },

  async listOrdersFromSo(signal?: AbortSignal): Promise<unknown[]> {
    const response = await apiClient.get<unknown[]>(`${PRODUCTION_BASE}/orders/so-list`, { signal });
    return response.data;
  },

  // ─── Job Card ───────────────────────────────────────────────────────────
  async listJobCards(params: ProductionPageParams, signal?: AbortSignal): Promise<ProductionPage<JobCard>> {
    const response = await apiClient.get<PageDto<JobCard>>(ENDPOINTS.jobCards, {
      params: toParams(params),
      signal,
    });
    return response.data;
  },

  async getJobCard(id: number | string, signal?: AbortSignal): Promise<JobCard> {
    const response = await apiClient.get<JobCard>(`${ENDPOINTS.jobCards}/${id}`, { signal });
    return response.data;
  },

  async createJobCard(payload: Record<string, unknown>): Promise<JobCard> {
    const response = await apiClient.post<JobCard>(ENDPOINTS.jobCards, payload);
    return response.data;
  },

  async updateJobCard(id: number | string, payload: Record<string, unknown>): Promise<JobCard> {
    const response = await apiClient.put<JobCard>(`${ENDPOINTS.jobCards}/${id}`, payload);
    return response.data;
  },

  async deleteJobCard(id: number | string): Promise<void> {
    await apiClient.delete(`${ENDPOINTS.jobCards}/${id}`);
  },

  async createJobCardFromWorkOrder(workOrderNumber: string): Promise<unknown> {
    const response = await apiClient.post(`${ENDPOINTS.jobCards}/from-work-order`, { workOrderNumber });
    return response.data;
  },

  async jobCardAction(id: number | string, action: string, note?: string): Promise<unknown> {
    const response = await apiClient.post(`${ENDPOINTS.jobCards}/${id}/actions/${action}`, note ? { note } : undefined);
    return response.data;
  },

  async completionCheck(id: number | string, signal?: AbortSignal): Promise<unknown> {
    const response = await apiClient.get(`${ENDPOINTS.jobCards}/${id}/completion-check`, { signal });
    return response.data;
  },

  async listJobCardSubjobs(jobCardId: number | string, signal?: AbortSignal): Promise<JobCardSubjob[]> {
    const response = await apiClient.get<JobCardSubjob[]>(`${ENDPOINTS.jobCards}/${jobCardId}/subjobs`, { signal });
    return response.data;
  },

  async createJobCardSubjob(jobCardId: number | string, payload: Record<string, unknown>): Promise<JobCardSubjob> {
    const response = await apiClient.post<JobCardSubjob>(`${ENDPOINTS.jobCards}/${jobCardId}/subjobs`, payload);
    return response.data;
  },

  async updateJobCardSubjob(lineId: number | string, payload: Record<string, unknown>): Promise<JobCardSubjob> {
    const response = await apiClient.put<JobCardSubjob>(`${ENDPOINTS.jobCards}/subjobs/${lineId}`, payload);
    return response.data;
  },

  async deleteJobCardSubjob(lineId: number | string): Promise<void> {
    await apiClient.delete(`${ENDPOINTS.jobCards}/subjobs/${lineId}`);
  },

  async jobCardSubjobAction(lineId: number | string, action: string, note?: string): Promise<unknown> {
    const response = await apiClient.post(`${ENDPOINTS.jobCards}/subjobs/${lineId}/actions/${action}`, note ? { note } : undefined);
    return response.data;
  },

  // ─── Production Entry ───────────────────────────────────────────────────
  async listEntries(params: ProductionPageParams, signal?: AbortSignal): Promise<ProductionPage<ProductionEntry>> {
    const response = await apiClient.get<PageDto<ProductionEntry>>(ENDPOINTS.entries, {
      params: toParams(params),
      signal,
    });
    return response.data;
  },

  async createEntry(payload: ProductionEntryLinePayload): Promise<ProductionEntry> {
    const response = await apiClient.post<ProductionEntry>(ENDPOINTS.entries, payload);
    return response.data;
  },

  // ─── Product Conversion ─────────────────────────────────────────────────
  async listConversions(params: ProductionPageParams, signal?: AbortSignal): Promise<ProductionPage<ProductConversion>> {
    const response = await apiClient.get<PageDto<ProductConversion>>(ENDPOINTS.conversions, {
      params: toParams(params),
      signal,
    });
    return response.data;
  },

  // ─── Production Return ──────────────────────────────────────────────────
  async listReturns(params: ProductionPageParams, signal?: AbortSignal): Promise<ProductionPage<ProductionReturn>> {
    const response = await apiClient.get<PageDto<ProductionReturn>>(ENDPOINTS.returns, {
      params: toParams(params),
      signal,
    });
    return response.data;
  },

  // ─── Production Log Sheet ───────────────────────────────────────────────
  async listLogSheets(params: ProductionPageParams, signal?: AbortSignal): Promise<ProductionPage<ProductionLogSheet>> {
    const response = await apiClient.get<PageDto<ProductionLogSheet>>(ENDPOINTS.logSheets, {
      params: toParams(params),
      signal,
    });
    return response.data;
  },

  async listLogActivities(logSheetId: number | string, signal?: AbortSignal): Promise<ProductionLogActivity[]> {
    const response = await apiClient.get<ProductionLogActivity[]>(
      `${ENDPOINTS.logSheets}/${logSheetId}/activities`,
      { signal }
    );
    return response.data;
  },

  // ─── Idle Time ──────────────────────────────────────────────────────────
  async listIdleTime(params: ProductionPageParams, signal?: AbortSignal): Promise<ProductionPage<IdleTimeEntry>> {
    const response = await apiClient.get<PageDto<IdleTimeEntry>>(ENDPOINTS.idleTime, {
      params: toParams(params),
      signal,
    });
    return response.data;
  },

  // ─── Pending / Dashboard ────────────────────────────────────────────────
  async listPending(signal?: AbortSignal): Promise<ProductionPendingRow[]> {
    const response = await apiClient.get<ProductionPendingRow[]>(ENDPOINTS.pending, { signal });
    return response.data;
  },

  async getDashboard(signal?: AbortSignal): Promise<ProductionDashboardSummary> {
    const response = await apiClient.get<ProductionDashboardSummary>(ENDPOINTS.dashboard, { signal });
    return response.data;
  },

  // ─── Generic action (POST /<endpoint>/<id>/actions/<action>) ────────────
  async runAction(endpoint: keyof typeof ENDPOINTS, id: number | string, payload: ProductionActionPayload): Promise<unknown> {
    const response = await apiClient.post(`${ENDPOINTS[endpoint]}/${id}/actions/${payload.action}`, {
      note: payload.note ?? '',
      qty: payload.qty,
    });
    return response.data;
  },

  // ─── Print ──────────────────────────────────────────────────────────────
  printDocument(docType: string, id: number | string, mode: 'print' | 'download' = 'print') {
    const base = import.meta.env.VITE_API_BASE_URL || '/api';
    printDoc(`${base}${PRODUCTION_BASE}/${docType}/${id}/print?download=${mode === 'download'}`, mode);
  },

  // ─── Tool Life / Tool Change Entry ───────────────────────────────────────
  async listToolLife(params?: { toolCode?: string; jobCardNumber?: string }): Promise<unknown[]> {
    const response = await apiClient.get<unknown[]>(ENDPOINTS.toolLife, { params });
    return response.data;
  },

  async createToolLife(payload: Record<string, unknown>): Promise<unknown> {
    const response = await apiClient.post(ENDPOINTS.toolLife, payload);
    return response.data;
  },
};

type ProductionPageParams = {
  page: number;
  size: number;
  sort?: string;
  search?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
};

function toParams(p: ProductionPageParams) {
  return {
    page: p.page,
    size: p.size,
    sort: p.sort || 'id,desc',
    search: p.search || undefined,
    status: p.status || undefined,
    fromDate: p.fromDate || undefined,
    toDate: p.toDate || undefined,
  };
}