import apiClient from '../api/axiosClient';
import { printDocument as printDoc } from '../utils/printDocument';
import type { PageDto } from '../types/api.types';

export const salesApi = {
  async listDocs(docType: string, params: { page?: number; size?: number; sort?: string; search?: string; status?: string; type?: string }): Promise<PageDto<Record<string, unknown>>> {
    const response = await apiClient.get<PageDto<Record<string, unknown>>>(`/v1/sales/${docType}`, { params });
    return response.data;
  },

  async getDoc(docType: string, id: number | string): Promise<Record<string, unknown>> {
    const response = await apiClient.get<Record<string, unknown>>(`/v1/sales/${docType}/${id}`);
    return response.data;
  },

  async createDoc(docType: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await apiClient.post<Record<string, unknown>>(`/v1/sales/${docType}`, payload);
    return response.data;
  },

  async updateDoc(docType: string, id: number | string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await apiClient.put<Record<string, unknown>>(`/v1/sales/${docType}/${id}`, payload);
    return response.data;
  },

  async deleteDoc(docType: string, id: number | string): Promise<void> {
    await apiClient.delete(`/v1/sales/${docType}/${id}`);
  },

  async nextDocNumber(docType: string): Promise<{ nextNumber: string }> {
    const response = await apiClient.get<{ nextNumber: string }>(`/v1/sales/${docType}/next-number`);
    return response.data;
  },

  async docAction(docType: string, id: number | string, action: string, note?: string, options?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await apiClient.post<Record<string, unknown>>(`/v1/sales/${docType}/${id}/actions/${action}`, { note: note ?? '', options });
    return response.data;
  },

  async dashboard(): Promise<Record<string, number>> {
    const response = await apiClient.get<Record<string, number>>('/v1/sales/dashboard');
    return response.data;
  },

  printDocument(docType: string, id: number | string, mode: 'print' | 'download' = 'print') {
    const base = import.meta.env.VITE_API_BASE_URL || '/api';
    printDoc(`${base}/v1/sales/${docType}/${id}/print?download=${mode === 'download'}`, mode);
  },
};
