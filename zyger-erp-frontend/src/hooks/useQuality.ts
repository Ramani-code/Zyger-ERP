import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qualityApi } from '../services/quality-api';
import type {
  CharacteristicLinePayload,
  InspectionCreatePayload,
  InspectionListParams,
  DecisionInput,
  DecisionQuantitiesPayload,
  InspectionDto,
} from '../types/quality/quality.types';

export function useQualityInspectionList(params: InspectionListParams) {
  return useQuery({
    queryKey: ['quality', 'inspections', params],
    queryFn: () => qualityApi.getInspections(params),
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: 1,
  });
}

export function useQualityInspection(id?: number | string | null) {
  return useQuery({
    queryKey: ['quality', 'inspection', id],
    queryFn: () => qualityApi.getInspection(id as number | string),
    enabled: Boolean(id),
    staleTime: 0,
    retry: 1,
  });
}

export function useQualityInspectionCreate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: InspectionCreatePayload) => qualityApi.createInspection(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality', 'inspections'] });
    },
  });
}

export function useQualityInspectionUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number | string; payload: InspectionCreatePayload }) =>
      qualityApi.updateInspection(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality', 'inspections'] });
    },
  });
}

export function useQualityDecisionQuantitiesUpdate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number | string; payload: DecisionQuantitiesPayload }) =>
      qualityApi.updateDecisionQuantities(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality', 'inspection'] });
      queryClient.invalidateQueries({ queryKey: ['quality', 'inspections'] });
    },
  });
}

export function useQualityInspectionDelete() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number | string) => qualityApi.deleteInspection(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality', 'inspections'] });
    },
  });
}

export function useQualityNextNumber() {
  return useQuery({
    queryKey: ['quality', 'next-number'],
    queryFn: () => qualityApi.getNextNumber(),
    staleTime: 0,
    retry: 1,
  });
}

export function useQualitySaveMeasurements() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, lines }: { id: number | string; lines: CharacteristicLinePayload[] }) =>
      qualityApi.saveMeasurements(id, lines),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality', 'inspection'] });
    },
  });
}

export function useQualityWorkflowAction(action: 'start' | 'submit' | 'decide' | 'approve' | 'hold' | 'release-hold' | 'cancel' | 'reopen' | 'close') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, remarks }: { id: number | string; decision?: DecisionInput; remarks?: string }) => {
      switch (action) {
        case 'start':
          return qualityApi.start(id);
        case 'submit':
          return qualityApi.submit(id);
        case 'decide':
          return qualityApi.decide(id, decision as DecisionInput, remarks);
        case 'approve':
          return qualityApi.approve(id);
        case 'hold':
          return qualityApi.hold(id, remarks);
        case 'release-hold':
          return qualityApi.releaseHold(id);
        case 'cancel':
          return qualityApi.cancel(id, remarks);
        case 'reopen':
          return qualityApi.reopen(id, remarks);
        case 'close':
          return qualityApi.close(id);
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality'] });
    },
  });
}

export function useQualityInspectionPendingCount() {
  return useQuery({
    queryKey: ['quality', 'pending', 'count'],
    queryFn: () => qualityApi.getInspectionPendingCount(),
    staleTime: 60000,
    retry: 1,
  });
}

type WorkflowAction =
  | 'start'
  | 'submit'
  | 'decide'
  | 'approve'
  | 'hold'
  | 'release-hold'
  | 'cancel'
  | 'reopen'
  | 'close';

interface WorkflowVariables {
  id: number | string;
  action: WorkflowAction;
  decision?: DecisionInput;
  remarks?: string;
}

export function useQualityWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, action, decision, remarks }: WorkflowVariables): Promise<InspectionDto> => {
      if (action === 'decide') {
        return qualityApi.decide(id, (decision ?? 'PASS') as DecisionInput, remarks);
      }

      if (action === 'hold' || action === 'cancel' || action === 'reopen') {
        return qualityApi.workflow(id, action, { reason: remarks });
      }

      return qualityApi.workflow(id, action);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['quality', 'inspection', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['quality', 'inspections'] });
      queryClient.invalidateQueries({ queryKey: ['quality', 'pending'] });
    },
  });
}
