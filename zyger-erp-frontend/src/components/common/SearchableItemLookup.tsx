import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Type-to-search Item Code picker: a text input that filters a dropdown of
 * matching items live by code, name, or description as you type, with a
 * click-to-select suggestion list — instead of a plain <select> that only
 * lets you pick from a closed list. Originally built for Purchase document
 * line items (PurchaseDocScreen.tsx); this is the one shared copy every
 * Item Code picker across the app now uses.
 */
export default function SearchableItemLookup({
  value,
  onChange,
  disabled,
  items,
  allowOthers = false,
  placeholder = 'Type Item Code...',
}: {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  items: Array<{ id?: number | string; code: string; name?: string; description?: string }>;
  allowOthers?: boolean;
  placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState(value || '');
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateCoords = () => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 2,
        left: rect.left,
        width: Math.max(rect.width, 240),
      });
    }
  };

  useEffect(() => {
    setSearch(value || '');
  }, [value]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleScrollOrResize() {
      if (isOpen) updateCoords();
    }
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen]);

  const handleFocus = () => {
    updateCoords();
    setIsOpen(true);
  };

  const filteredItems = items.filter((item) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      item.code.toLowerCase().includes(q) ||
      (item.name && item.name.toLowerCase().includes(q)) ||
      (item.description && item.description.toLowerCase().includes(q))
    );
  });

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <input
        ref={inputRef}
        type="text"
        disabled={disabled}
        value={search}
        onFocus={handleFocus}
        onChange={(e) => {
          setSearch(e.target.value);
          onChange(e.target.value);
          updateCoords();
          setIsOpen(true);
        }}
        className="in"
        placeholder={placeholder}
        style={{ fontWeight: 700, color: '#1e3a8a', width: '100%', boxSizing: 'border-box' }}
      />
      {isOpen && !disabled && coords && createPortal(
        <div
          style={{
            position: 'fixed',
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            width: `${coords.width}px`,
            zIndex: 999999,
            maxHeight: '200px',
            overflowY: 'auto',
            backgroundColor: '#ffffff',
            border: '1px solid #94a3b8',
            borderRadius: '6px',
            boxShadow: '0 10px 30px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            boxSizing: 'border-box',
          }}
        >
          {filteredItems.length === 0 ? (
            <div style={{ padding: '8px 12px', fontSize: '12px', color: '#94a3b8', textAlign: 'left' }}>
              No matching items
            </div>
          ) : (
            filteredItems.map((item) => (
              <div
                key={item.id || item.code}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setSearch(item.code);
                  onChange(item.code);
                  setIsOpen(false);
                }}
                style={{
                  padding: '8px 10px',
                  cursor: 'pointer',
                  borderBottom: '1px solid #f1f5f9',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontWeight: 700, fontSize: '12px', color: '#1e293b' }}>
                  {item.code}
                </span>
                <span style={{ fontSize: '11px', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.name || item.description}
                </span>
              </div>
            ))
          )}
          {allowOthers && (
            <div
              onMouseDown={(e) => {
                e.preventDefault();
                setSearch('OTHERS');
                onChange('OTHERS');
                setIsOpen(false);
              }}
              style={{
                padding: '8px 10px',
                cursor: 'pointer',
                fontWeight: 700,
                fontSize: '11px',
                color: '#2563eb',
                backgroundColor: '#f8fafc',
                borderTop: '1px solid #e2e8f0',
                textAlign: 'left',
              }}
            >
              + OTHERS (Custom Item)
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
