import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { deliveryChallanService } from '../services/deliveryChallanService';
import { masterService } from '../services/masterService';
import type {
  DeliveryChallanDocumentAction,
  DeliveryChallanListParams,
  DeliveryChallanPayload,
  DeliveryChallanTypeConfig,
} from '../types/inventory/deliveryChallan.types';

export function useDcList(
  config: DeliveryChallanTypeConfig,
  params: DeliveryChallanListParams
) {
  return useQuery({
    queryKey: [config.screenId, 'list', params],
    queryFn: ({ signal }) =>
      deliveryChallanService.getList(config.apiPath, params, signal),
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: 1,
  });
}

export function useDcDocument(
  config: DeliveryChallanTypeConfig,
  id?: string | null
) {
  return useQuery({
    queryKey: [config.screenId, 'document', id],
    queryFn: ({ signal }) =>
      deliveryChallanService.getById(config.apiPath, id as string, signal),
    enabled: Boolean(id),
    retry: 1,
  });
}

export function useDcNextNumber(config: DeliveryChallanTypeConfig) {
  return useQuery({
    queryKey: [config.screenId, 'next-number'],
    queryFn: ({ signal }) =>
      deliveryChallanService.getNextNumber(config.apiPath, signal),
    staleTime: 0,
    retry: 1,
  });
}

export function useDcLookups(config: DeliveryChallanTypeConfig) {
  const itemsQuery = useQuery({
    queryKey: ['master', 'items'],
    queryFn: ({ signal }) => masterService.getItems(signal),
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });

  const locationsQuery = useQuery({
    queryKey: ['inventory', 'locations'],
    queryFn: ({ signal }) => masterService.getLocations(signal),
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });

  const customersQuery = useQuery({
    queryKey: ['master', 'customers'],
    queryFn: ({ signal }) => masterService.getCustomers(signal),
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });

  const suppliersQuery = useQuery({
    queryKey: ['master', 'suppliers'],
    queryFn: ({ signal }) => masterService.getSuppliers(signal),
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });

  const storesQuery = useQuery({
    queryKey: ['master', 'stores'],
    queryFn: ({ signal }) => masterService.getStores(signal),
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });

  const uomsQuery = useQuery({
    queryKey: ['master', 'uoms'],
    queryFn: ({ signal }) => masterService.getUoms(signal),
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });

  const partyOptions =
    config.partySource === 'customers'
      ? (customersQuery.data ?? []).map((party) => ({
          value: party.code,
          label: `${party.code} — ${party.name}`,
        }))
      : (suppliersQuery.data ?? []).map((party) => ({
          value: party.code,
          label: `${party.code} — ${party.name}`,
        }));

  const isLoading =
    itemsQuery.isPending ||
    locationsQuery.isPending ||
    customersQuery.isPending ||
    suppliersQuery.isPending ||
    storesQuery.isPending;

  const isError =
    itemsQuery.isError ||
    locationsQuery.isError ||
    customersQuery.isError ||
    suppliersQuery.isError ||
    storesQuery.isError;

  const firstError =
    itemsQuery.error ||
    locationsQuery.error ||
    customersQuery.error ||
    suppliersQuery.error ||
    storesQuery.error;

  const errorMessage =
    firstError instanceof Error
      ? firstError.message
      : `Unable to load ${config.title} master data.`;

  const refetch = () =>
    Promise.all([
      itemsQuery.refetch(),
      locationsQuery.refetch(),
      customersQuery.refetch(),
      suppliersQuery.refetch(),
      storesQuery.refetch(),
      uomsQuery.refetch(),
    ]);

  const parties =
    config.partySource === 'customers'
      ? customersQuery.data ?? []
      : suppliersQuery.data ?? [];

  return {
    items: itemsQuery.data ?? [],
    locations: locationsQuery.data ?? [],
    stores: storesQuery.data ?? [],
    uoms: uomsQuery.data ?? [],
    partyOptions,
    parties,
    isLoading,
    isError,
    errorMessage,
    refetch,
  };
}

interface UpdateVariables {
  id: string;
  payload: DeliveryChallanPayload;
}

interface ActionVariables {
  id: string;
  action: DeliveryChallanDocumentAction;
  note?: string;
}

export function useDcMutations(config: DeliveryChallanTypeConfig) {
  const queryClient = useQueryClient();

  const invalidateScreen = () =>
    queryClient.invalidateQueries({
      queryKey: [config.screenId],
    });

  const invalidateStock = () =>
    queryClient.invalidateQueries({
      queryKey: ['inventory', 'stock'],
    });

  const createMutation = useMutation({
    mutationFn: (payload: DeliveryChallanPayload) =>
      deliveryChallanService.create(config.apiPath, payload),
    onSuccess: invalidateScreen,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: UpdateVariables) =>
      deliveryChallanService.update(config.apiPath, id, payload),
    onSuccess: invalidateScreen,
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) =>
      deliveryChallanService.remove(config.apiPath, id),
    onSuccess: invalidateScreen,
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action, note }: ActionVariables) =>
      deliveryChallanService.action(config.apiPath, id, action, note),
    onSuccess: () => {
      invalidateScreen();
      invalidateStock();
    },
  });

  return {
    createMutation,
    updateMutation,
    removeMutation,
    actionMutation,
  };
}