import apiClient from '../api/axiosClient';
import type { PageDto } from '../types/api.types';
import type {
  InspectionCreatePayload,
  InspectionDto,
  InspectionListParams,
  InspectionListRowDto,
  DecisionInput,
  DecisionQuantitiesPayload,
  NcrCreatePayload,
  NcrDto,
  CharacteristicLinePayload,
  QualityDashboardData,
} from '../types/quality/quality.types';

export const qualityApi = {
  async getInspections(params: InspectionListParams): Promise<PageDto<InspectionListRowDto>> {
    const response = await apiClient.get<PageDto<InspectionListRowDto>>('/v1/quality/inspections', {
      params: {
        page: params.page,
        size: params.size,
        sort: params.sort || 'date,desc',
        search: params.search,
        status: params.status,
        inspectionType: params.inspectionType,
        itemCode: params.itemCode,
      },
    });
    return response.data;
  },

  async getInspection(id: number | string): Promise<InspectionDto> {
    const response = await apiClient.get<InspectionDto>(`/v1/quality/inspections/${id}`);
    return response.data;
  },

  async createInspection(payload: InspectionCreatePayload): Promise<InspectionDto> {
    const response = await apiClient.post<InspectionDto>('/v1/quality/inspections', payload);
    return response.data;
  },

  async createInspectionFromInward(payload: { sourceDocKey: string; sourceDocId: number }): Promise<{
    inspectionId: number | null;
    inspectionIds: number[];
    inspections: InspectionDto[];
  }> {
    const response = await apiClient.post('/v1/quality/inspections/from-inward', payload);
    return response.data;
  },

  async updateInspection(id: number | string, payload: InspectionCreatePayload): Promise<InspectionDto> {
    const response = await apiClient.put<InspectionDto>(`/v1/quality/inspections/${id}`, payload);
    return response.data;
  },

  async updateDecisionQuantities(id: number | string, payload: DecisionQuantitiesPayload): Promise<InspectionDto> {
    const response = await apiClient.put<InspectionDto>(`/v1/quality/inspections/${id}/decision-quantities`, payload);
    return response.data;
  },

  async deleteInspection(id: number | string): Promise<void> {
    await apiClient.delete(`/v1/quality/inspections/${id}`);
  },

  async getNextNumber(typeParam?: string): Promise<{ nextNumber: string }> {
    const url = `/v1/quality/inspections/next-number${typeParam || ''}`;
    const response = await apiClient.get<{ nextNumber: string }>(url);
    return response.data;
  },

  async saveMeasurements(id: number | string, lines: CharacteristicLinePayload[]): Promise<InspectionDto> {
    const response = await apiClient.post<InspectionDto>(`/v1/quality/inspections/${id}/save-measurements`, lines);
    return response.data;
  },

  async bulkImportMeasurements(id: number | string, csvContent: string): Promise<{ matched: number; unmatched: number; totalRows: number; inspection: InspectionDto }> {
    const response = await apiClient.post(`/v1/quality/inspections/${id}/characteristics/bulk-import`, csvContent, {
      headers: { 'Content-Type': 'text/plain' },
    });
    return response.data as any;
  },

  async start(id: number | string): Promise<InspectionDto> {
    const response = await apiClient.post<InspectionDto>(`/v1/quality/inspections/${id}/start`);
    return response.data;
  },

  async submit(id: number | string): Promise<InspectionDto> {
    const response = await apiClient.post<InspectionDto>(`/v1/quality/inspections/${id}/submit`);
    return response.data;
  },

  async decide(id: number | string, decision: DecisionInput, remarks?: string): Promise<InspectionDto> {
    const response = await apiClient.post<InspectionDto>(`/v1/quality/inspections/${id}/decision`, {
      decision,
      remarks,
    });
    return response.data;
  },

  async approve(id: number | string): Promise<InspectionDto> {
    const response = await apiClient.post<InspectionDto>(`/v1/quality/inspections/${id}/approve`);
    return response.data;
  },

  async hold(id: number | string, reason?: string): Promise<InspectionDto> {
    const response = await apiClient.post<InspectionDto>(`/v1/quality/inspections/${id}/hold`, { reason });
    return response.data;
  },

  async releaseHold(id: number | string): Promise<InspectionDto> {
    const response = await apiClient.post<InspectionDto>(`/v1/quality/inspections/${id}/release-hold`);
    return response.data;
  },

  async cancel(id: number | string, reason?: string): Promise<InspectionDto> {
    const response = await apiClient.post<InspectionDto>(`/v1/quality/inspections/${id}/cancel`, { reason });
    return response.data;
  },

  async reopen(id: number | string, reason?: string): Promise<InspectionDto> {
    const response = await apiClient.post<InspectionDto>(`/v1/quality/inspections/${id}/reopen`, { reason });
    return response.data;
  },

  async close(id: number | string): Promise<InspectionDto> {
    const response = await apiClient.post<InspectionDto>(`/v1/quality/inspections/${id}/close`);
    return response.data;
  },

  async workflow(
    id: number | string,
    action: 'start' | 'submit' | 'approve' | 'hold' | 'release-hold' | 'cancel' | 'reopen' | 'close',
    body?: Record<string, unknown>
  ): Promise<InspectionDto> {
    const response = await apiClient.post<InspectionDto>(`/v1/quality/inspections/${id}/${action}`, body ?? {});
    return response.data;
  },

  async getInspectionPendingCount(): Promise<{ count: number }> {
    const response = await apiClient.get<{ count: number }>('/v1/quality/inspection-pending/count');
    return response.data;
  },

  // NCR endpoints
  async getNcrs(params: { page: number; size: number; sort?: string; search?: string; status?: string }): Promise<PageDto<NcrDto>> {
    const response = await apiClient.get<PageDto<NcrDto>>('/v1/quality/ncrs', {
      params: { ...params, status: params.status || 'PENDING' },
    });
    return response.data;
  },

  async getNcr(id: number | string): Promise<NcrDto> {
    const response = await apiClient.get<NcrDto>(`/v1/quality/ncrs/${id}`);
    return response.data;
  },

  async createNcr(payload: NcrCreatePayload): Promise<NcrDto> {
    const response = await apiClient.post<NcrDto>('/v1/quality/ncrs', payload);
    return response.data;
  },

  async updateNcr(id: number | string, payload: NcrCreatePayload): Promise<NcrDto> {
    const response = await apiClient.put<NcrDto>(`/v1/quality/ncrs/${id}`, payload);
    return response.data;
  },

  async deleteNcr(id: number | string): Promise<void> {
    await apiClient.delete(`/v1/quality/ncrs/${id}`);
  },

  async getNextNcrNumber(): Promise<{ nextNumber: string }> {
    const response = await apiClient.get<{ nextNumber: string }>('/v1/quality/ncrs/next-number');
    return response.data;
  },

  // ---------- Generic quality documents (NCR, concession, TC, calibration, complaint, CAPA, 8D) ----------

  async listDocs(docType: string, params: { page?: number; size?: number; sort?: string; search?: string; status?: string; type?: string }): Promise<PageDto<Record<string, unknown>>> {
    const response = await apiClient.get<PageDto<Record<string, unknown>>>(`/v1/quality/docs/${docType}`, { params });
    return response.data;
  },

  async getDoc(docType: string, id: number | string): Promise<Record<string, unknown>> {
    const response = await apiClient.get<Record<string, unknown>>(`/v1/quality/docs/${docType}/${id}`);
    return response.data;
  },

  async createDoc(docType: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await apiClient.post<Record<string, unknown>>(`/v1/quality/docs/${docType}`, payload);
    return response.data;
  },

  async updateDoc(docType: string, id: number | string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await apiClient.put<Record<string, unknown>>(`/v1/quality/docs/${docType}/${id}`, payload);
    return response.data;
  },

  async deleteDoc(docType: string, id: number | string): Promise<void> {
    await apiClient.delete(`/v1/quality/docs/${docType}/${id}`);
  },

  async nextDocNumber(docType: string): Promise<{ nextNumber: string }> {
    const response = await apiClient.get<{ nextNumber: string }>(`/v1/quality/docs/${docType}/next-number`);
    return response.data;
  },

  async docAction(docType: string, id: number | string, action: string, note?: string): Promise<Record<string, unknown>> {
    const response = await apiClient.post<Record<string, unknown>>(`/v1/quality/docs/${docType}/${id}/actions/${action}`, { note: note ?? '' });
    return response.data;
  },

  // ---------- Calibration instruments ----------

  async getInstruments(status?: string): Promise<Array<Record<string, unknown>>> {
    const response = await apiClient.get<Array<Record<string, unknown>>>('/v1/quality/calibration/instruments', { params: { status: status || undefined } });
    return response.data;
  },

  async saveInstrument(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await apiClient.post<Record<string, unknown>>('/v1/quality/calibration/instruments', payload);
    return response.data;
  },

  async retireInstrument(id: number | string, reason?: string): Promise<void> {
    await apiClient.delete(`/v1/quality/calibration/instruments/${id}`, { data: { reason: reason ?? 'retired' } });
  },

  async calibrationStats(): Promise<Record<string, number>> {
    const response = await apiClient.get<Record<string, number>>('/v1/quality/calibration/stats');
    return response.data;
  },

  // ---------- Aggregate dashboard (plan §33) ----------

  async dashboard(): Promise<QualityDashboardData> {
    const response = await apiClient.get<QualityDashboardData>('/v1/quality/dashboard');
    return response.data;
  },
};
