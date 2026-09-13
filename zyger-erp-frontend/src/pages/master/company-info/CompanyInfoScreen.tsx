import { useEffect, useState, useRef } from 'react';
import apiClient from '../../../api/axiosClient';
import { useToast } from '../../../contexts/ToastContext';
import { getApiErrorMessage } from '../../../utils/apiError';

export interface CompanyInfoState {
  id?: number;
  companyName: string;
  printName: string;
  displayType: string;
  registeredAddress: string;
  deliveryAddress: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  mobile: string;
  email: string;
  website: string;
  contactPerson: string;
  pinNo: string;
  msmeNo: string;
  tanNo: string;
  latitude: string;
  longitude: string;

  // Banking (shown as Bank Transfer Details on the tax invoice)
  bankName: string;
  bankAccountHolder: string;
  bankAccount: string;
  bankIfsc: string;
  bankBranch: string;

  // Statutory
  pan: string;
  pfNo: string;
  esiNo: string;
  iecCode: string;
  cin: string;
  gstin: string;
  gstState: string;
  gstinUser: string;
  eInvoiceUser: string;
  eInvoicePass: string;
  eWaybillUser: string;
  eWaybillPass: string;

  // Security
  apiKey: string;
  accessToken: string;

  // Logos
  companyLogoUrl?: string;
  isoLogoUrl?: string;
  bisLogoUrl?: string;
}

const defaultCompanyState: CompanyInfoState = {
  companyName: 'Zyger ERP',
  printName: 'Zyger ERP',
  displayType: '',
  registeredAddress: '',
  deliveryAddress: '',
  city: '',
  state: '',
  pincode: '',
  phone: '',
  mobile: '+91 00000 00000',
  email: 'info@company.com',
  website: 'https://www.company.com',
  contactPerson: '',
  pinNo: '',
  msmeNo: '',
  tanNo: '',
  latitude: '12.9716° N',
  longitude: '77.5946° E',

  bankName: '',
  bankAccountHolder: '',
  bankAccount: '',
  bankIfsc: '',
  bankBranch: '',

  pan: '',
  pfNo: '',
  esiNo: '',
  iecCode: '',
  cin: '',
  gstin: '',
  gstState: '',
  gstinUser: '',
  eInvoiceUser: 'Sanjai M',
  eInvoicePass: '********',
  eWaybillUser: '',
  eWaybillPass: '',

  apiKey: 'sk-mfg-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX',
  accessToken: 'at-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX',
};

export default function CompanyInfoScreen() {
  const { toast } = useToast();
  const [form, setForm] = useState<CompanyInfoState>(defaultCompanyState);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showEInvoicePass, setShowEInvoicePass] = useState(false);
  const [showEWaybillPass, setShowEWaybillPass] = useState(false);

  // Section collapse states
  const [openSec, setOpenSec] = useState({
    comm: true,
    stat: true,
    bank: true,
    sec: true,
    logos: true,
  });

  const toggleSec = (key: keyof typeof openSec) => setOpenSec(c => ({ ...c, [key]: !c[key] }));

  useEffect(() => {
    (async () => {
      try {
        const { data } = await apiClient.get('/master/company-info');
        if (data && Object.keys(data).length > 0) {
          setForm(c => ({ ...c, ...data }));
        }
      } catch {
        /* fallback to default state */
      }
      setLoading(false);
    })();
  }, []);

  const [uploadingLogo, setUploadingLogo] = useState<string | null>(null);
  const companyLogoRef = useRef<HTMLInputElement>(null);
  const isoLogoRef = useRef<HTMLInputElement>(null);
  const bisLogoRef = useRef<HTMLInputElement>(null);

  const handleLogoUpload = async (file: File, type: 'company' | 'iso' | 'bis') => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast('Logo must be under 10MB.', 'error'); return; }
    if (!file.type.startsWith('image/')) { toast('Only image files are allowed.', 'error'); return; }
    setUploadingLogo(type);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('type', type);
      const { data } = await apiClient.post('/master/company-info/logo', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const field = type === 'company' ? 'companyLogoUrl' : type === 'iso' ? 'isoLogoUrl' : 'bisLogoUrl';
      setFld(field, data.url);
      toast(`${type.charAt(0).toUpperCase() + type.slice(1)} logo uploaded.`);
      // Notify the layout/sidebar to refresh the brand logo immediately.
      window.dispatchEvent(new CustomEvent('company-info-updated'));
    } catch {
      toast('Logo upload failed.', 'error');
    }
    setUploadingLogo(null);
  };

  const logoPreviewUrl = (url?: string) => {
    if (!url) return undefined;
    const type = url.includes('/iso/') ? 'iso' : url.includes('/bis/') ? 'bis' : 'company';
    const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api';
    // Query param cache-buster so a freshly uploaded logo renders immediately.
    return baseUrl.replace(/\/$/, '') + '/master/company-info/logo/' + type + '?v=' + encodeURIComponent(url);
  };

  const setFld = (k: keyof CompanyInfoState, v: any) => setForm(c => ({ ...c, [k]: v }));

  const save = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!form.companyName?.trim()) { toast('Company Name is required.', 'error'); return; }
    setBusy(true);
    try {
      await apiClient.put('/master/company-info', form);
      toast('Company Info saved successfully.');
    } catch (err) {
      toast(getApiErrorMessage(err, 'Failed to save company info.'), 'error');
    }
    setBusy(false);
  };

  const regenApiKey = () => {
    const random = Math.random().toString(36).substring(2, 10).toUpperCase();
    setFld('apiKey', `sk-mfg-${random}-XXXX-XXXX-XXXX-XXXXXXXXXXXX`);
    toast('API Key regenerated.');
  };

  const regenAccessToken = () => {
    const random = Math.random().toString(36).substring(2, 10).toUpperCase();
    setFld('accessToken', `at-${random}-XXXX-XXXX-XXXX-XXXXXXXXXXXX`);
    toast('Access Token regenerated.');
  };

  if (loading) {
    return (
      <div className="panel">
        <div className="empty">Loading company details...</div>
      </div>
    );
  }

  return (
    <>
      {/* Top Header Bar */}
      <div className="pg-head pg-head-flex" style={{ marginBottom: '20px' }}>
        <div className="pg-head-text">
          <h1>Company Info</h1>
          <p>Manage your company details, statutory info and security settings</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button type="button" className="btn btn-secondary" onClick={() => window.location.href = '/'} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span className="material-symbols-rounded">home</span> Back to Home
          </button>
          <button type="button" className="btn btn-primary" onClick={() => save()} disabled={busy}>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <form onSubmit={save}>
        {/* SECTION 1: Communication */}
        <div className="sec-head" onClick={() => toggleSec('comm')} style={{ cursor: 'pointer' }}>
          <div className="sec-title">
            <span className="material-symbols-rounded">chat</span>
            <span>Communication</span>
          </div>
          <span className="material-symbols-rounded sec-toggle">{openSec.comm ? 'expand_less' : 'expand_more'}</span>
        </div>

        {openSec.comm && (
          <div className="sec-body" style={{ background: '#fff', border: '1px solid #bfdbfe', borderRadius: '0 0 12px 12px', padding: '24px', marginBottom: '24px' }}>
            <div className="fgrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
              <label className="fld">
                <span>COMPANY NAME *</span>
                <input className="in" type="text" required value={form.companyName} onChange={e => setFld('companyName', e.target.value)} placeholder="Zyger ERP" />
              </label>
              <label className="fld">
                <span>PRINT NAME</span>
                <input className="in" type="text" value={form.printName} onChange={e => setFld('printName', e.target.value)} placeholder="Zyger ERP" />
              </label>
              <label className="fld">
                <span>COMPANY DISPLAY TYPE</span>
                <select className="in" value={form.displayType} onChange={e => setFld('displayType', e.target.value)}>
                  <option value="">-- Select --</option>
                  <option value="Private Limited">Private Limited</option>
                  <option value="Public Limited">Public Limited</option>
                  <option value="Proprietorship">Proprietorship</option>
                  <option value="Partnership">Partnership</option>
                </select>
              </label>
            </div>

            {/* Address */}
            <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#1e3a8a', textTransform: 'uppercase', marginBottom: '12px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
              ADDRESS
            </div>
            <div className="fgrid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '16px' }}>
              <label className="fld">
                <span>REGISTERED ADDRESS</span>
                <textarea className="in" rows={2} placeholder="Enter full registered address" value={form.registeredAddress} onChange={e => setFld('registeredAddress', e.target.value)} />
              </label>
              <label className="fld">
                <span>DELIVERY ADDRESS</span>
                <textarea className="in" rows={2} placeholder="Enter delivery address" value={form.deliveryAddress} onChange={e => setFld('deliveryAddress', e.target.value)} />
              </label>
            </div>

            <div className="fgrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
              <label className="fld">
                <span>CITY</span>
                <input className="in" type="text" placeholder="City" value={form.city} onChange={e => setFld('city', e.target.value)} />
              </label>
              <label className="fld">
                <span>STATE</span>
                <select className="in" value={form.state} onChange={e => setFld('state', e.target.value)}>
                  <option value="">-- Select --</option>
                  <option value="Tamil Nadu">Tamil Nadu</option>
                  <option value="Karnataka">Karnataka</option>
                  <option value="Maharashtra">Maharashtra</option>
                  <option value="Gujarat">Gujarat</option>
                </select>
              </label>
              <label className="fld">
                <span>PINCODE</span>
                <input className="in" type="text" placeholder="000000" value={form.pincode} onChange={e => setFld('pincode', e.target.value)} />
              </label>
            </div>

            {/* Contact Details */}
            <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#1e3a8a', textTransform: 'uppercase', marginBottom: '12px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
              CONTACT DETAILS
            </div>
            <div className="fgrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
              <label className="fld">
                <span>MOBILE NO</span>
                <input className="in" type="text" placeholder="+91 00000 00000" value={form.mobile} onChange={e => setFld('mobile', e.target.value)} />
              </label>
              <label className="fld">
                <span>PHONE NO</span>
                <input className="in" type="text" placeholder="+91 00000 00000" value={form.phone} onChange={e => setFld('phone', e.target.value)} />
              </label>
              <label className="fld">
                <span>EMAIL</span>
                <input className="in" type="email" placeholder="info@company.com" value={form.email} onChange={e => setFld('email', e.target.value)} />
              </label>
              <label className="fld">
                <span>WEBSITE</span>
                <input className="in" type="text" placeholder="https://www.company.com" value={form.website} onChange={e => setFld('website', e.target.value)} />
              </label>

              <label className="fld">
                <span>CONTACT PERSON</span>
                <input className="in" type="text" placeholder="Contact person name" value={form.contactPerson} onChange={e => setFld('contactPerson', e.target.value)} />
              </label>
              <label className="fld">
                <span>PIN NO</span>
                <input className="in" type="text" placeholder="Pin number" value={form.pinNo} onChange={e => setFld('pinNo', e.target.value)} />
              </label>
              <label className="fld">
                <span>MSME NO</span>
                <input className="in" type="text" placeholder="MSME registration number" value={form.msmeNo} onChange={e => setFld('msmeNo', e.target.value)} />
              </label>

              <label className="fld">
                <span>TAN NO</span>
                <input className="in" type="text" placeholder="XXXXXXXXXX" value={form.tanNo} onChange={e => setFld('tanNo', e.target.value)} />
              </label>
              <label className="fld">
                <span>LATITUDE</span>
                <input className="in" type="text" placeholder="12.9716° N" value={form.latitude} onChange={e => setFld('latitude', e.target.value)} />
              </label>
              <label className="fld">
                <span>LONGITUDE</span>
                <input className="in" type="text" placeholder="77.5946° E" value={form.longitude} onChange={e => setFld('longitude', e.target.value)} />
              </label>
            </div>
          </div>
        )}

        {/* SECTION 2: Statutory */}
        <div className="sec-head" onClick={() => toggleSec('stat')} style={{ cursor: 'pointer' }}>
          <div className="sec-title">
            <span className="material-symbols-rounded">gavel</span>
            <span>Statutory</span>
          </div>
          <span className="material-symbols-rounded sec-toggle">{openSec.stat ? 'expand_less' : 'expand_more'}</span>
        </div>

        {openSec.stat && (
          <div className="sec-body" style={{ background: '#fff', border: '1px solid #bfdbfe', borderRadius: '0 0 12px 12px', padding: '24px', marginBottom: '24px' }}>
            <div className="fgrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
              <label className="fld">
                <span>PAN / IT NO</span>
                <input className="in" type="text" placeholder="XXXXXXXXXX" value={form.pan} onChange={e => setFld('pan', e.target.value)} />
              </label>
              <label className="fld">
                <span>PF NO</span>
                <input className="in" type="text" placeholder="PF registration number" value={form.pfNo} onChange={e => setFld('pfNo', e.target.value)} />
              </label>
              <label className="fld">
                <span>ESI NO</span>
                <input className="in" type="text" placeholder="ESI registration number" value={form.esiNo} onChange={e => setFld('esiNo', e.target.value)} />
              </label>

              <label className="fld">
                <span>IMPORT / EXPORT CODE</span>
                <input className="in" type="text" placeholder="IEC number" value={form.iecCode} onChange={e => setFld('iecCode', e.target.value)} />
              </label>
              <label className="fld">
                <span>CIN</span>
                <input className="in" type="text" placeholder="L00000XX0000XXX000000" value={form.cin} onChange={e => setFld('cin', e.target.value)} />
              </label>
              <label className="fld">
                <span>GSTIN</span>
                <input className="in" type="text" placeholder="OOXXXXX0000XOXX" value={form.gstin} onChange={e => setFld('gstin', e.target.value)} />
              </label>

              <label className="fld">
                <span>GST STATE</span>
                <select className="in" value={form.gstState} onChange={e => setFld('gstState', e.target.value)}>
                  <option value="">-- Select --</option>
                  <option value="Tamil Nadu">Tamil Nadu</option>
                  <option value="Karnataka">Karnataka</option>
                  <option value="Maharashtra">Maharashtra</option>
                </select>
              </label>
              <label className="fld span2">
                <span>GSTIN USER</span>
                <input className="in" type="text" placeholder="GST portal username" value={form.gstinUser} onChange={e => setFld('gstinUser', e.target.value)} />
              </label>
            </div>

            {/* E-Invoice & E-Waybill Credentials */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', marginTop: '16px' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#1e3a8a', textTransform: 'uppercase', marginBottom: '14px' }}>
                E-INVOICE & E-WAYBILL CREDENTIALS
              </div>
              <div className="fgrid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
                <label className="fld">
                  <span>E-INVOICE USER</span>
                  <input className="in" type="text" placeholder="Sanjai M" value={form.eInvoiceUser} onChange={e => setFld('eInvoiceUser', e.target.value)} />
                </label>
                <label className="fld" style={{ position: 'relative' }}>
                  <span>E-INVOICE PASSWORD</span>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input className="in" type={showEInvoicePass ? 'text' : 'password'} value={form.eInvoicePass} onChange={e => setFld('eInvoicePass', e.target.value)} style={{ paddingRight: '40px' }} />
                    <button type="button" onClick={() => setShowEInvoicePass(s => !s)} style={{ position: 'absolute', right: '10px', background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                      <span className="material-symbols-rounded" style={{ fontSize: '20px' }}>{showEInvoicePass ? 'visibility_off' : 'visibility'}</span>
                    </button>
                  </div>
                </label>

                <label className="fld">
                  <span>E-WAYBILL USER</span>
                  <input className="in" type="text" placeholder="E-waybill portal username" value={form.eWaybillUser} onChange={e => setFld('eWaybillUser', e.target.value)} />
                </label>
                <label className="fld" style={{ position: 'relative' }}>
                  <span>E-WAYBILL PASSWORD</span>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input className="in" type={showEWaybillPass ? 'text' : 'password'} placeholder="E-waybill password" value={form.eWaybillPass} onChange={e => setFld('eWaybillPass', e.target.value)} style={{ paddingRight: '40px' }} />
                    <button type="button" onClick={() => setShowEWaybillPass(s => !s)} style={{ position: 'absolute', right: '10px', background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}>
                      <span className="material-symbols-rounded" style={{ fontSize: '20px' }}>{showEWaybillPass ? 'visibility_off' : 'visibility'}</span>
                    </button>
                  </div>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* SECTION 3: Bank Transfer Details */}
        <div className="sec-head" onClick={() => toggleSec('bank')} style={{ cursor: 'pointer' }}>
          <div className="sec-title">
            <span className="material-symbols-rounded">account_balance</span>
            <span>Bank Transfer Details</span>
          </div>
          <span className="material-symbols-rounded sec-toggle">{openSec.bank ? 'expand_less' : 'expand_more'}</span>
        </div>

        {openSec.bank && (
          <div className="sec-body" style={{ background: '#fff', border: '1px solid #bfdbfe', borderRadius: '0 0 12px 12px', padding: '24px', marginBottom: '24px' }}>
            <div className="fgrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
              <label className="fld">
                <span>BANK NAME</span>
                <input className="in" type="text" placeholder="e.g. HDFC Bank" value={form.bankName} onChange={e => setFld('bankName', e.target.value)} />
              </label>
              <label className="fld">
                <span>ACCOUNT NAME</span>
                <input className="in" type="text" placeholder="Account holder name" value={form.bankAccountHolder} onChange={e => setFld('bankAccountHolder', e.target.value)} />
              </label>
              <label className="fld">
                <span>ACCOUNT NO</span>
                <input className="in" type="text" placeholder="Bank account number" value={form.bankAccount} onChange={e => setFld('bankAccount', e.target.value)} />
              </label>

              <label className="fld">
                <span>IFSC CODE</span>
                <input className="in" type="text" placeholder="e.g. HDFC0000001" value={form.bankIfsc} onChange={e => setFld('bankIfsc', e.target.value)} />
              </label>
              <label className="fld span2">
                <span>BRANCH</span>
                <input className="in" type="text" placeholder="e.g. Coimbatore" value={form.bankBranch} onChange={e => setFld('bankBranch', e.target.value)} />
              </label>
            </div>
            <div style={{ fontSize: '0.82rem', color: '#64748b' }}>
              These details are printed in the "Bank Transfer Details" section of your Tax Invoice.
            </div>
          </div>
        )}

        {/* SECTION 4: Security */}
        <div className="sec-head" onClick={() => toggleSec('sec')} style={{ cursor: 'pointer' }}>
          <div className="sec-title">
            <span className="material-symbols-rounded">security</span>
            <span>Security</span>
          </div>
          <span className="material-symbols-rounded sec-toggle">{openSec.sec ? 'expand_less' : 'expand_more'}</span>
        </div>

        {openSec.sec && (
          <div className="sec-body" style={{ background: '#fff', border: '1px solid #bfdbfe', borderRadius: '0 0 12px 12px', padding: '24px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '16px' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#1e3a8a', display: 'block', marginBottom: '6px' }}>API KEY</span>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input className="in" type="text" readOnly value={form.apiKey} style={{ flex: 1, backgroundColor: '#f8fafc', fontWeight: 600 }} />
                  <button type="button" className="btn btn-secondary" onClick={regenApiKey} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>refresh</span> Regenerate
                  </button>
                </div>
              </div>

              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#1e3a8a', display: 'block', marginBottom: '6px' }}>ACCESS TOKEN</span>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input className="in" type="text" readOnly value={form.accessToken} style={{ flex: 1, backgroundColor: '#f8fafc', fontWeight: 600 }} />
                  <button type="button" className="btn btn-secondary" onClick={regenAccessToken} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>refresh</span> Regenerate
                  </button>
                </div>
              </div>
            </div>

            {/* Warning Alert Banner */}
            <div style={{ background: '#fff7ed', border: '1px solid #ffedd5', borderRadius: '8px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="material-symbols-rounded" style={{ color: '#c2410c' }}>shield</span>
              <span style={{ fontSize: '0.82rem', color: '#c2410c', fontWeight: 600 }}>
                Keep your API Key and Access Token confidential. Do not share them with unauthorized parties. Regenerating will invalidate the previous token.
              </span>
            </div>
          </div>
        )}

        {/* SECTION 5: Company Logos */}
        <div className="sec-head" onClick={() => toggleSec('logos')} style={{ cursor: 'pointer' }}>
          <div className="sec-title">
            <span className="material-symbols-rounded">image</span>
            <span>Company Logos</span>
          </div>
          <span className="material-symbols-rounded sec-toggle">{openSec.logos ? 'expand_less' : 'expand_more'}</span>
        </div>

        {openSec.logos && (
          <div className="sec-body" style={{ background: '#fff', border: '1px solid #bfdbfe', borderRadius: '0 0 12px 12px', padding: '24px', marginBottom: '24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
              {/* COMPANY LOGO */}
              <div style={{ border: '2px dashed #bfdbfe', borderRadius: '12px', padding: '24px', textAlign: 'center', background: '#faf5ff' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#1e3a8a', marginBottom: '16px' }}>COMPANY LOGO</div>
                <input ref={companyLogoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f, 'company'); e.target.value = ''; }} />
                {form.companyLogoUrl ? (
                  <div style={{ width: '64px', height: '64px', margin: '0 auto 12px', borderRadius: '12px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent' }}>
                    <img src={logoPreviewUrl(form.companyLogoUrl)} alt="Company Logo" style={{ width: '100%', height: '100%', objectFit: 'contain', background: 'transparent' }} />
                  </div>
                ) : (
                  <div style={{ width: '64px', height: '64px', margin: '0 auto 12px', background: '#eff6ff', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    <img src="/Zyger_Logo.svg" alt="Default Zyger Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  </div>
                )}
                <button type="button" className="btn btn-sm btn-secondary" disabled={uploadingLogo === 'company'} onClick={() => companyLogoRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
                  <span className="material-symbols-rounded">{uploadingLogo === 'company' ? 'hourglass_empty' : 'upload'}</span> {uploadingLogo === 'company' ? 'Uploading...' : 'Upload'}
                </button>
                {form.companyLogoUrl && <button type="button" className="btn btn-sm" style={{ marginLeft: '4px', color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setFld('companyLogoUrl', '')}>Remove</button>}
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>PNG, JPG up to 10MB</div>
              </div>

              {/* ISO LOGO */}
              <div style={{ border: '2px dashed #bfdbfe', borderRadius: '12px', padding: '24px', textAlign: 'center', background: '#faf5ff' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#1e3a8a', marginBottom: '16px' }}>ISO LOGO</div>
                <input ref={isoLogoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f, 'iso'); e.target.value = ''; }} />
                {form.isoLogoUrl ? (
                  <div style={{ width: '64px', height: '64px', margin: '0 auto 12px', borderRadius: '12px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent' }}>
                    <img src={logoPreviewUrl(form.isoLogoUrl)} alt="ISO Logo" style={{ width: '100%', height: '100%', objectFit: 'contain', background: 'transparent' }} />
                  </div>
                ) : (
                  <div style={{ width: '64px', height: '64px', margin: '0 auto 12px', background: '#eff6ff', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '32px', color: '#3b82f6' }}>image</span>
                  </div>
                )}
                <button type="button" className="btn btn-sm btn-secondary" disabled={uploadingLogo === 'iso'} onClick={() => isoLogoRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
                  <span className="material-symbols-rounded">{uploadingLogo === 'iso' ? 'hourglass_empty' : 'upload'}</span> {uploadingLogo === 'iso' ? 'Uploading...' : 'Upload'}
                </button>
                {form.isoLogoUrl && <button type="button" className="btn btn-sm" style={{ marginLeft: '4px', color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setFld('isoLogoUrl', '')}>Remove</button>}
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>PNG, JPG up to 10MB</div>
              </div>

              {/* BIS LOGO */}
              <div style={{ border: '2px dashed #bfdbfe', borderRadius: '12px', padding: '24px', textAlign: 'center', background: '#faf5ff' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#1e3a8a', marginBottom: '16px' }}>BIS LOGO</div>
                <input ref={bisLogoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f, 'bis'); e.target.value = ''; }} />
                {form.bisLogoUrl ? (
                  <div style={{ width: '64px', height: '64px', margin: '0 auto 12px', borderRadius: '12px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent' }}>
                    <img src={logoPreviewUrl(form.bisLogoUrl)} alt="BIS Logo" style={{ width: '100%', height: '100%', objectFit: 'contain', background: 'transparent' }} />
                  </div>
                ) : (
                  <div style={{ width: '64px', height: '64px', margin: '0 auto 12px', background: '#eff6ff', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '32px', color: '#3b82f6' }}>image</span>
                  </div>
                )}
                <button type="button" className="btn btn-sm btn-secondary" disabled={uploadingLogo === 'bis'} onClick={() => bisLogoRef.current?.click()} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
                  <span className="material-symbols-rounded">{uploadingLogo === 'bis' ? 'hourglass_empty' : 'upload'}</span> {uploadingLogo === 'bis' ? 'Uploading...' : 'Upload'}
                </button>
                {form.bisLogoUrl && <button type="button" className="btn btn-sm" style={{ marginLeft: '4px', color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => setFld('bisLogoUrl', '')}>Remove</button>}
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>PNG, JPG up to 10MB</div>
              </div>
            </div>
          </div>
        )}

        <div className="actbar" style={{ marginTop: '20px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" className="btn btn-secondary" onClick={() => window.location.href = '/'}>
            <span className="material-symbols-rounded">home</span> Back to Home
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving...' : 'Save Company Info'}
          </button>
        </div>
      </form>
    </>
  );
}
