import { useState, useEffect, useCallback } from 'react';
import axiosClient from '../../api/axiosClient';

interface Attachment {
  id: number;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  category: string;
  uploadedBy: string;
  uploadedAt: string;
}

interface Props {
  ownerType: string;
  ownerId: number;
  onClose: () => void;
}

export default function AttachmentsDrawer({ ownerType, ownerId, onClose }: Props) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState('OTHER');

  const load = useCallback(async () => {
    try {
      const r = await axiosClient.get('/attachments', { params: { ownerType, ownerId } });
      setAttachments(r.data as Attachment[]);
    } catch { /* empty */ }
  }, [ownerType, ownerId]);

  useEffect(() => { load(); }, [load]);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('ownerType', ownerType);
    fd.append('ownerId', String(ownerId));
    fd.append('category', category);
    try {
      await axiosClient.post('/attachments', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      load();
    } catch (err) {
      console.error('Upload failed', err);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this attachment?')) return;
    await axiosClient.delete(`/attachments/${id}`);
    load();
  }

  async function handleDownload(id: number) {
    try {
      const r = await axiosClient.get(`/attachments/${id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(r.data as Blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      console.error('Download failed', err);
    }
  }

  function formatSize(bytes: number) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 380, background: 'var(--surface)', borderLeft: '1px solid var(--border)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <b style={{ fontSize: 14 }}>Attachments</b>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', fontSize: 18 }}>✕</button>
      </div>

      <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={category} onChange={e => setCategory(e.target.value)} style={{ padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)' }}>
            <option value="OTHER">Other</option>
            <option value="PHOTO">Photo</option>
            <option value="DOCUMENT">Document</option>
            <option value="CERTIFICATE">Certificate</option>
            <option value="DRAWING">Drawing</option>
          </select>
          <label style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid var(--blue)', color: 'var(--blue)', cursor: 'pointer' }}>
            {uploading ? 'Uploading...' : 'Choose File'}
            <input type="file" accept="image/*,.pdf,.doc,.docx" onChange={handleUpload} style={{ display: 'none' }} disabled={uploading} />
          </label>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {attachments.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            No attachments uploaded
          </div>
        )}
        {attachments.map(a => (
          <div key={a.id} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.fileName}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 8, marginTop: 2 }}>
                <span>{formatSize(a.sizeBytes)}</span>
                <span>{a.category}</span>
                {a.uploadedBy && <span>by {a.uploadedBy}</span>}
              </div>
            </div>
            <button
              onClick={() => handleDownload(a.id)}
              title="Download"
              style={{ background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontSize: 14, padding: '4px 8px' }}
            >
              ⬇
            </button>
            <button onClick={() => handleDelete(a.id)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 14, padding: '4px 8px' }}>🗑</button>
          </div>
        ))}
      </div>
    </div>
  );
}
