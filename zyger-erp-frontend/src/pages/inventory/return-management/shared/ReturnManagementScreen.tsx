import { useEffect, useState } from 'react';
import type { ReturnManagementTypeConfig } from '../../../../types/inventory/returnManagement.types';
import ReturnManagementList from './ReturnManagementList';
import ReturnManagementForm from './ReturnManagementForm';
import ReturnManagementReports from './ReturnManagementReports';

interface ReturnManagementScreenProps {
  initialDocId?: string;
  viewOnly?: boolean;
  config: ReturnManagementTypeConfig;
}

export default function ReturnManagementScreen({
  config,
  initialDocId,
  viewOnly: viewOnlyProp,
}: ReturnManagementScreenProps) {
  const [mode, setMode] = useState<'list' | 'form' | 'reports'>('list');
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [viewOnly, setViewOnly] = useState(false);
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
      <ReturnManagementForm
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

  if (mode === 'reports') {
    return (
      <div>
        <div style={{ marginBottom: '16px' }}>
          <button type="button" className="btn" onClick={handleBack}>
            <span className="material-symbols-rounded">arrow_back</span>
            Back to List
          </button>
        </div>
        <ReturnManagementReports />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
        <button
          type="button"
          className="btn"
          onClick={() => setMode('reports')}
        >
          <span className="material-symbols-rounded">analytics</span>
          Registers & Reports
        </button>
      </div>
      <ReturnManagementList
        config={config}
        onAdd={openAdd}
        onEdit={openEdit}
        onView={openView}
      />
    </div>
  );
}