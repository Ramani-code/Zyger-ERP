import { useEffect, useState } from 'react';
import type { StockIssueTypeConfig } from '../../../../types/inventory/stockIssue.types';
import StockIssueList from './StockIssueList';
import StockIssueForm from './StockIssueForm';

interface StockIssueScreenProps {
  initialDocId?: string;
  viewOnly?: boolean;
  config: StockIssueTypeConfig;
}

export default function StockIssueScreen({
  config,
  initialDocId,
  viewOnly: viewOnlyProp,
}: StockIssueScreenProps) {
  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    if (!initialDocId) return;
    setDocumentId(initialDocId);
    setViewOnly(viewOnlyProp ?? false);
    setFormKey((previous) => previous + 1);
    setMode('form');
  }, [initialDocId, viewOnlyProp]);


  const openAdd = () => {
    setDocumentId(null);
    setViewOnly(false);
    setFormKey((previous) => previous + 1);
    setMode('form');
  };

  const openEdit = (id: string) => {
    setDocumentId(id);
    setViewOnly(false);
    setFormKey((previous) => previous + 1);
    setMode('form');
  };

  const openView = (id: string) => {
    setDocumentId(id);
    setViewOnly(true);
    setFormKey((previous) => previous + 1);
    setMode('form');
  };

  const handleBack = () => {
    setMode('list');
    setDocumentId(null);
  };

  const handleSaved = (id: string) => {
    setDocumentId(id);
  };

  if (mode === 'form') {
    return (
      <StockIssueForm
        key={formKey}
        config={config}
        documentId={documentId}
        viewOnly={viewOnly}
        onBack={handleBack}
        onSaved={handleSaved}
        onReset={openAdd}
      />
    );
  }

  return (
    <StockIssueList config={config} onAdd={openAdd} onEdit={openEdit} onView={openView} />
  );
}