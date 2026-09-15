import { useState, useEffect, useRef } from 'react';
import apiClient from '../../api/axiosClient';
import { filterPurchaseRelevantItems } from '../../utils/itemClassification';

export interface ItemSearchResult {
  id?: number | string;
  code: string;
  itemCode?: string;
  name?: string;
  description?: string;
  specification?: string;
  uom?: string;
}

interface ItemSearchDropdownProps {
  value?: string;
  onChange: (item: ItemSearchResult) => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function ItemSearchDropdown({
  value = '',
  onChange,
  placeholder = 'Type 2-3 letters of item name or specification...',
  disabled = false,
}: ItemSearchDropdownProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ItemSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value && !query) {
      setQuery(value);
    }
  }, [value]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await apiClient.get(`/master/items?search=${encodeURIComponent(query.trim())}&size=20`);
        const data: any = response.data;
        const itemsList = Array.isArray(data) ? data : data?.content || [];
        setResults(filterPurchaseRelevantItems(itemsList));
        setOpen(itemsList.length > 0);
      } catch (err) {
        console.error('Failed to search items:', err);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = (item: ItemSearchResult) => {
    const itemCode = item.code || item.itemCode || '';
    const itemName = item.name || item.description || itemCode;
    const spec = item.specification || item.description || '';
    const uom = item.uom || 'Pcs';

    setQuery(`${itemName} (${spec ? spec : itemCode})`);
    setOpen(false);

    onChange({
      ...item,
      code: itemCode,
      name: itemName,
      specification: spec,
      uom: uom,
    });
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      <div className="input-group">
        <input
          type="text"
          className="f-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open && e.target.value.length >= 2) setOpen(true);
          }}
          onFocus={() => {
            if (results.length > 0) setOpen(true);
          }}
          placeholder={placeholder}
          disabled={disabled}
        />
        {loading && (
          <span
            className="material-symbols-rounded spin"
            style={{
              position: 'absolute',
              right: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
            }}
          >
            sync
          </span>
        )}
      </div>

      {open && results.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 1000,
            background: 'var(--bg-card, #ffffff)',
            border: '1px solid var(--border-color, #e2e8f0)',
            borderRadius: '8px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1)',
            maxHeight: '260px',
            overflowY: 'auto',
            marginTop: '4px',
          }}
        >
          {results.map((item, idx) => {
            const itemCode = item.code || item.itemCode || '';
            const itemName = item.name || item.description || itemCode;
            const spec = item.specification || item.description || '';

            return (
              <div
                key={idx}
                onClick={() => handleSelect(item)}
                style={{
                  padding: '10px 14px',
                  cursor: 'pointer',
                  borderBottom: idx < results.length - 1 ? '1px solid var(--border-subtle, #f1f5f9)' : 'none',
                }}
                className="dropdown-item-hover"
              >
                <div style={{ fontWeight: 600, color: 'var(--text-main, #1e293b)' }}>{itemName}</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted, #64748b)' }}>
                  Code: {itemCode} | Spec: {spec || 'N/A'} | UOM: {item.uom || 'Pcs'}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
