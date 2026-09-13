import { useEffect, useState } from 'react';
import apiClient from '../../../api/axiosClient';
import { useToast } from '../../../contexts/ToastContext';
import { getApiErrorMessage } from '../../../utils/apiError';
import ConfirmActionModal from '../../../components/common/ConfirmActionModal';
import AuditHistoryDrawer from '../../../components/common/AuditHistoryDrawer';
import { exportSimpleCsv } from '../../../utils/csvExport';

export interface MachineItem {
  id: number;
  code: string;
  name: string;
  brand?: string;
  machineType?: string;
  machineGroup?: string;
  workCenterCode?: string;
  machineCost?: number;
  gstRate?: number;
  gstAmount?: number;
  totalCostWithGst?: number;
  capacity?: number;
  hourlyRate?: number;
  status: string; // AVAILABLE, IN_USE, UNDER_MAINTENANCE, BREAKDOWN, IDLE

  // CNC Specs
  controllerBrand?: string;
  spindleSpeed?: number;
  spindlePower?: number;
  toolCapacity?: string;
  maxMachiningDia?: number;
  maxMachiningLength?: number;
  xAxisTravel?: number;
  yAxisTravel?: number;
  zAxisTravel?: number;
  rapidTraverse?: number;

  // CNC-shop target-state FRS fields
  machineClass?: string;
  axisCount?: number;
  spindleSpeedMin?: number;
  spindleSpeedMax?: number;
  chuckOrTableSize?: string;
  linkedMeterId?: number;

  // Tailstock & Auxiliary Specs
  tailstockType?: string;
  tailstockStroke?: number;
  quillDiameter?: number;
  quillTaper?: string;
  coolantCapacity?: number;
  maintenanceScheduleRef?: string;
  skillRequirement?: string;
  programReference?: string;

  active: boolean;
}

export default function MachineScreen() {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<'LIST' | 'FORM'>('LIST');
  const [rows, setRows] = useState<MachineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MachineItem | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditEntityId, setAuditEntityId] = useState<number | undefined>(undefined);

  // Form State - Basic & Commercial
  const [code, setCode] = useState('MAC-0001');
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('Ace Micromatic');
  const [machineType, setMachineType] = useState('CNC Lathe');
  const [machineGroup, setMachineGroup] = useState('Turning Shop');
  const [workCenterCode, setWorkCenterCode] = useState('WC-01');
  const [machineCost, setMachineCost] = useState<number>(3500000);
  const [gstRate, setGstRate] = useState<number>(18);
  const [capacity, setCapacity] = useState<number>(800);
  const [hourlyRate, setHourlyRate] = useState<number>(1200);
  const [status, setStatus] = useState('AVAILABLE');
  const [active, setActive] = useState(true);

  // CNC Technical Specs
  const [controllerBrand, setControllerBrand] = useState('FANUC 0i-TF');
  const [spindleSpeed, setSpindleSpeed] = useState<number>(4500);
  const [spindlePower, setSpindlePower] = useState<number>(11);
  const [toolCapacity, setToolCapacity] = useState('12 Station Turret');
  const [maxMachiningDia, setMaxMachiningDia] = useState<number>(320);
  const [maxMachiningLength, setMaxMachiningLength] = useState<number>(500);
  const [xAxisTravel, setXAxisTravel] = useState<number>(200);
  const [yAxisTravel, setYAxisTravel] = useState<number>(0);
  const [zAxisTravel, setZAxisTravel] = useState<number>(520);
  const [rapidTraverse, setRapidTraverse] = useState<number>(30);

  // CNC-shop target-state FRS fields
  const [machineClass, setMachineClass] = useState('CNC Turning');
  const [axisCount, setAxisCount] = useState<number>(2);
  const [spindleSpeedMin, setSpindleSpeedMin] = useState<number>(0);
  const [spindleSpeedMax, setSpindleSpeedMax] = useState<number>(4500);
  const [chuckOrTableSize, setChuckOrTableSize] = useState('250mm 3-Jaw Chuck');

  // Tailstock & Aux Specs
  const [tailstockType, setTailstockType] = useState('Hydraulic Programmable');
  const [tailstockStroke, setTailstockStroke] = useState<number>(100);
  const [quillDiameter, setQuillDiameter] = useState<number>(75);
  const [quillTaper, setQuillTaper] = useState('MT4');
  const [coolantCapacity, setCoolantCapacity] = useState<number>(150);
  const [maintenanceRef, setMaintenanceRef] = useState('PM-SCH-01');
  const [skillReq, setSkillReq] = useState('Level 3 CNC Operator');
  const [programRef, setProgramRef] = useState('CNC-LATHE-01');

  // Calculated values
  const gstAmount = Math.round(((machineCost || 0) * (gstRate || 0)) / 100);
  const totalCostWithGst = (machineCost || 0) + gstAmount;

  const loadAll = async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/master/machines');
      const content = data?.content ?? data ?? [];
      setRows(content);
    } catch (e) {
      toast(getApiErrorMessage(e, 'Failed to load machines.'), 'error');
    }
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, []);

  const openNew = async () => {
    setEditId(null);
    setName('');
    setBrand('');
    setMachineType('');
    setMachineGroup('');
    setWorkCenterCode('');
    setMachineCost(0);
    setGstRate(0);
    setCapacity(0);
    setHourlyRate(0);
    setStatus('AVAILABLE');
    setActive(true);

    setControllerBrand('');
    setSpindleSpeed(0);
    setSpindlePower(0);
    setToolCapacity('');
    setMaxMachiningDia(0);
    setMaxMachiningLength(0);
    setXAxisTravel(0);
    setYAxisTravel(0);
    setZAxisTravel(0);
    setRapidTraverse(0);

    setMachineClass('');
    setAxisCount(0);
    setSpindleSpeedMin(0);
    setSpindleSpeedMax(0);
    setChuckOrTableSize('');

    setTailstockType('');
    setTailstockStroke(0);
    setQuillDiameter(0);
    setQuillTaper('');
    setCoolantCapacity(0);
    setMaintenanceRef('');
    setSkillReq('');
    setProgramRef('');

    setViewMode('FORM');
    try {
      const { data } = await apiClient.get('/master/machines/next-code');
      setCode(data.code || 'MAC-0001');
    } catch {
      setCode(`MAC-000${rows.length + 1}`);
    }
  };

  const openEdit = (item: MachineItem) => {
    setEditId(item.id);
    setCode(item.code);
    setName(item.name || '');
    setBrand(item.brand || 'Ace Micromatic');
    setMachineType(item.machineType || 'CNC Lathe');
    setMachineGroup(item.machineGroup || '');
    setWorkCenterCode(item.workCenterCode || '');
    setMachineCost(item.machineCost || 3500000);
    setGstRate(item.gstRate || 18);
    setCapacity(item.capacity || 0);
    setHourlyRate(item.hourlyRate || 0);
    setStatus(item.status || 'AVAILABLE');
    setActive(item.active ?? true);

    setControllerBrand(item.controllerBrand || 'FANUC 0i-TF');
    setSpindleSpeed(item.spindleSpeed || 4500);
    setSpindlePower(item.spindlePower || 11);
    setToolCapacity(item.toolCapacity || '12 Station Turret');
    setMaxMachiningDia(item.maxMachiningDia || 320);
    setMaxMachiningLength(item.maxMachiningLength || 500);
    setXAxisTravel(item.xAxisTravel || 200);
    setYAxisTravel(item.yAxisTravel || 0);
    setZAxisTravel(item.zAxisTravel || 520);
    setRapidTraverse(item.rapidTraverse || 30);

    setMachineClass(item.machineClass || 'CNC Turning');
    setAxisCount(item.axisCount || 2);
    setSpindleSpeedMin(item.spindleSpeedMin || 0);
    setSpindleSpeedMax(item.spindleSpeedMax || 4500);
    setChuckOrTableSize(item.chuckOrTableSize || '');

    setTailstockType(item.tailstockType || 'Hydraulic Programmable');
    setTailstockStroke(item.tailstockStroke || 100);
    setQuillDiameter(item.quillDiameter || 75);
    setQuillTaper(item.quillTaper || 'MT4');
    setCoolantCapacity(item.coolantCapacity || 150);
    setMaintenanceRef(item.maintenanceScheduleRef || '');
    setSkillReq(item.skillRequirement || '');
    setProgramRef(item.programReference || '');

    setViewMode('FORM');
  };

  const save = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!code.trim()) { toast('Machine Code is required.', 'error'); return; }
    if (!name.trim()) { toast('Machine Name is required.', 'error'); return; }

    setBusy(true);
    try {
      const payload = {
        code,
        name,
        brand,
        machineType,
        machineGroup,
        workCenterCode,
        machineCost,
        gstRate,
        gstAmount,
        totalCostWithGst,
        capacity,
        hourlyRate,
        status,
        controllerBrand,
        spindleSpeed,
        spindlePower,
        toolCapacity,
        maxMachiningDia,
        maxMachiningLength,
        xAxisTravel,
        yAxisTravel,
        zAxisTravel,
        rapidTraverse,
        machineClass,
        axisCount,
        spindleSpeedMin,
        spindleSpeedMax,
        chuckOrTableSize,
        tailstockType,
        tailstockStroke,
        quillDiameter,
        quillTaper,
        coolantCapacity,
        maintenanceScheduleRef: maintenanceRef,
        skillRequirement: skillReq,
        programReference: programRef,
        active,
      };

      if (editId) {
        await apiClient.put(`/master/machines/${editId}`, payload);
        toast('Machine updated successfully.');
      } else {
        await apiClient.post('/master/machines', payload);
        toast('Machine created successfully.');
      }
      setViewMode('LIST');
      loadAll();
    } catch (err) {
      toast(getApiErrorMessage(err, 'Failed to save machine.'), 'error');
    }
    setBusy(false);
  };

  const del = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await apiClient.delete(`/master/machines/${deleteTarget.id}`);
      toast('Machine deleted.');
      setDeleteTarget(null);
      loadAll();
    } catch (e) {
      toast(getApiErrorMessage(e, 'Delete failed.'), 'error');
    }
    setBusy(false);
  };

  const filteredRows = rows.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (r.code && r.code.toLowerCase().includes(q)) ||
      (r.name && r.name.toLowerCase().includes(q)) ||
      (r.brand && r.brand.toLowerCase().includes(q)) ||
      (r.machineType && r.machineType.toLowerCase().includes(q)) ||
      (r.workCenterCode && r.workCenterCode.toLowerCase().includes(q))
    );
  });

  const getStatusBadge = (st: string) => {
    switch (st) {
      case 'AVAILABLE': return <span style={{ fontWeight: 700, color: '#166534', backgroundColor: '#dcfce7', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>Available</span>;
      case 'IN_USE': return <span style={{ fontWeight: 700, color: '#1e40af', backgroundColor: '#dbeafe', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>In Use</span>;
      case 'UNDER_MAINTENANCE': return <span style={{ fontWeight: 700, color: '#854d0e', backgroundColor: '#fef9c3', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>Maintenance</span>;
      case 'BREAKDOWN': return <span style={{ fontWeight: 700, color: '#991b1b', backgroundColor: '#fee2e2', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>Breakdown</span>;
      default: return <span style={{ fontWeight: 700, color: '#475569', backgroundColor: '#f1f5f9', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem' }}>{st}</span>;
    }
  };

  return (
    <>
      <div className="pg-head pg-head-flex" style={{ marginBottom: '20px' }}>
        <div className="pg-head-text" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {viewMode === 'FORM' && (
            <button type="button" className="btn btn-secondary" onClick={() => setViewMode('LIST')} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span className="material-symbols-rounded">arrow_back</span> Back
            </button>
          )}
          <div>
            <h1>{viewMode === 'LIST' ? 'Machine Master' : editId ? 'Edit Machine' : 'New Machine'}</h1>
            <p>Master -&gt; Assets -&gt; Machine Master. CNC specifications, cost, GST, brand & tailstock details.</p>
          </div>
        </div>

        <div>
          {viewMode === 'LIST' ? (
            <button type="button" className="btn btn-primary" onClick={openNew}>
              + Add Machine
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" className="btn btn-primary" onClick={() => save()} disabled={busy}>
                {busy ? 'Saving...' : 'Save Machine'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setViewMode('LIST')}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {viewMode === 'LIST' ? (
        <div className="panel">
          <div className="panel-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <input
                type="text"
                className="in"
                placeholder="Search Code, Name, Brand, Type..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ width: '280px' }}
              />
              <select className="in" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: '180px' }}>
                <option value="">All Statuses</option>
                <option value="AVAILABLE">Available</option>
                <option value="IN_USE">In Use</option>
                <option value="UNDER_MAINTENANCE">Under Maintenance</option>
                <option value="BREAKDOWN">Breakdown</option>
              </select>
              <span style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>{filteredRows.length} records</span>
              <button className="btn btn-sm" onClick={() => exportSimpleCsv(filteredRows as unknown as Record<string, unknown>[], 'machines')} title="Export CSV">
                <span className="material-symbols-rounded" style={{ fontSize: 16 }}>download</span> CSV
              </button>
              <button className="btn btn-sm" onClick={() => { setAuditEntityId(undefined); setAuditOpen(true); }} title="Audit History">
                <span className="material-symbols-rounded" style={{ fontSize: 16 }}>history</span>
              </button>
            </div>
          </div>

          <div className="twrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="num">S.No</th>
                  <th>MACHINE CODE</th>
                  <th>MACHINE NAME</th>
                  <th>BRAND / MAKE</th>
                  <th>TYPE</th>
                  <th>WORK CENTER</th>
                  <th>COST (INCL. GST ₹)</th>
                  <th>HOURLY RATE (₹)</th>
                  <th>TAILSTOCK</th>
                  <th>STATUS</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={11} className="empty">Loading machines...</td></tr>
                ) : filteredRows.length === 0 ? (
                  <tr><td colSpan={11} className="empty">No machines found.</td></tr>
                ) : (
                  filteredRows.map((r, idx) => (
                    <tr key={r.id}>
                      <td className="num mut">{idx + 1}</td>
                      <td style={{ fontWeight: 700, color: '#0f172a' }}>{r.code}</td>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td>{r.brand || 'Ace Micromatic'}</td>
                      <td>{r.machineType || 'CNC Lathe'}</td>
                      <td>{r.workCenterCode || 'WC-01'}</td>
                      <td className="num" style={{ fontWeight: 700, color: '#0f172a' }}>
                        ₹{(r.totalCostWithGst || 4130000).toLocaleString('en-IN')}
                      </td>
                      <td className="num" style={{ fontWeight: 700, color: '#0284c7' }}>₹{r.hourlyRate || '1200'}</td>
                      <td>{r.tailstockType || 'Hydraulic'}</td>
                      <td>{getStatusBadge(r.status)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button type="button" className="ibtn" title="Edit" onClick={() => openEdit(r)}>
                            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>edit</span>
                          </button>
                          <button type="button" className="ibtn danger" title="Delete" onClick={() => setDeleteTarget(r)}>
                            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="pager" style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Showing 1–{filteredRows.length} of {filteredRows.length}</span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button type="button" className="btn btn-sm" disabled>&lt;</button>
              <button type="button" className="btn btn-sm btn-primary">1</button>
              <button type="button" className="btn btn-sm" disabled>&gt;</button>
            </div>
          </div>
        </div>
      ) : (
        /* FORM VIEW INPUT PAGE */
        <form onSubmit={save}>
          {/* SECTION 1: Basic & Commercial Details */}
          <div className="sec-head">
            <div className="sec-title">
              <span className="material-symbols-rounded">precision_manufacturing</span>
              <span>1. Basic & Commercial Details</span>
            </div>
          </div>

          <div className="sec-body" style={{ background: '#fff', border: '1px solid #bfdbfe', borderRadius: '0 0 12px 12px', padding: '24px', marginBottom: '24px' }}>
            <div className="fgrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
              <label className="fld">
                <span>MACHINE CODE *</span>
                <input className="in" type="text" readOnly value={code} style={{ backgroundColor: '#f8fafc', fontWeight: 600 }} />
              </label>

              <label className="fld">
                <span>MACHINE NAME *</span>
                <input className="in" type="text" required placeholder="VMC CNC Machine 3-Axis" value={name} onChange={e => setName(e.target.value)} />
              </label>

              <label className="fld">
                <span>BRAND / MAKE *</span>
                <select className="in" value={brand} onChange={e => setBrand(e.target.value)}>
                  <option value="Haas">Haas</option>
                  <option value="Mazak">Mazak</option>
                  <option value="FANUC">FANUC</option>
                  <option value="Doosan / DN Solutions">Doosan / DN Solutions</option>
                  <option value="BFW">BFW (Bharat Fritz Werner)</option>
                  <option value="LMW">LMW (Lakshmi Machine Works)</option>
                  <option value="Ace Micromatic">Ace Micromatic</option>
                  <option value="DMG MORI">DMG MORI</option>
                  <option value="Okuma">Okuma</option>
                  <option value="Other">Other</option>
                </select>
              </label>

              <label className="fld">
                <span>MACHINE TYPE *</span>
                <select className="in" value={machineType} onChange={e => setMachineType(e.target.value)}>
                  <option value="VMC">VMC (Vertical Machining Center)</option>
                  <option value="HMC">HMC (Horizontal Machining Center)</option>
                  <option value="CNC Lathe">CNC Lathe / Turning Center</option>
                  <option value="5-Axis">5-Axis Machining Center</option>
                  <option value="Grinding">Grinding Machine</option>
                  <option value="Drilling">Drilling Machine</option>
                  <option value="Press">Press Machine</option>
                </select>
              </label>

              <label className="fld">
                <span>MACHINE GROUP</span>
                <input className="in" type="text" placeholder="Turning Shop" value={machineGroup} onChange={e => setMachineGroup(e.target.value)} />
              </label>

              <label className="fld">
                <span>WORK CENTER CODE</span>
                <input className="in" type="text" placeholder="WC-01" value={workCenterCode} onChange={e => setWorkCenterCode(e.target.value)} />
              </label>

              <label className="fld">
                <span>MACHINE COST (EXCL. GST ₹)</span>
                <input className="in" type="number" step="0.01" placeholder="3500000" value={machineCost} onChange={e => setMachineCost(parseFloat(e.target.value))} />
              </label>

              <label className="fld">
                <span>GST RATE (%)</span>
                <select className="in" value={gstRate} onChange={e => setGstRate(parseFloat(e.target.value))}>
                  <option value={18}>18% GST</option>
                  <option value={28}>28% GST</option>
                  <option value={12}>12% GST</option>
                  <option value={5}>5% GST</option>
                  <option value={0}>0% (Exempt)</option>
                </select>
              </label>

              <label className="fld">
                <span>GST AMOUNT (₹)</span>
                <input className="in" type="text" readOnly value={`₹ ${gstAmount.toLocaleString('en-IN')}`} style={{ backgroundColor: '#f8fafc', fontWeight: 600, color: '#0284c7' }} />
              </label>

              <label className="fld">
                <span>TOTAL COST (INCL. GST ₹)</span>
                <input className="in" type="text" readOnly value={`₹ ${totalCostWithGst.toLocaleString('en-IN')}`} style={{ backgroundColor: '#f8fafc', fontWeight: 700, color: '#0f172a' }} />
              </label>

              <label className="fld">
                <span>CAPACITY (HOURS/MONTH)</span>
                <input className="in" type="number" value={capacity} onChange={e => setCapacity(Number(e.target.value))} />
              </label>

              <label className="fld">
                <span>HOURLY OPERATING RATE (₹)</span>
                <input className="in" type="number" step="0.01" value={hourlyRate} onChange={e => setHourlyRate(parseFloat(e.target.value))} />
              </label>

              <label className="fld">
                <span>STATUS</span>
                <select className="in" value={status} onChange={e => setStatus(e.target.value)}>
                  <option value="AVAILABLE">Available</option>
                  <option value="IN_USE">In Use</option>
                  <option value="UNDER_MAINTENANCE">Under Maintenance</option>
                  <option value="BREAKDOWN">Breakdown</option>
                  <option value="IDLE">Idle</option>
                </select>
              </label>
            </div>

            <div>
              <label className="fld chk">
                <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
                <span>Active</span>
              </label>
            </div>
          </div>

          {/* SECTION 2: CNC Technical & Controller Specifications */}
          <div className="sec-head">
            <div className="sec-title">
              <span className="material-symbols-rounded">settings_suggest</span>
              <span>2. CNC Technical & Controller Specifications</span>
            </div>
          </div>

          <div className="sec-body" style={{ background: '#fff', border: '1px solid #bfdbfe', borderRadius: '0 0 12px 12px', padding: '24px', marginBottom: '24px' }}>
            <div className="fgrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
              <label className="fld">
                <span>MACHINE CLASS</span>
                <select className="in" value={machineClass} onChange={e => setMachineClass(e.target.value)}>
                  <option value="CNC Turning">CNC Turning</option>
                  <option value="CNC Milling">CNC Milling</option>
                  <option value="VMC">VMC</option>
                  <option value="HMC">HMC</option>
                  <option value="CNC Grinding">CNC Grinding</option>
                  <option value="Conventional">Conventional</option>
                  <option value="Inspection Equipment">Inspection Equipment</option>
                </select>
              </label>

              <label className="fld">
                <span>NO. OF AXES</span>
                <input className="in" type="number" value={axisCount} onChange={e => setAxisCount(parseInt(e.target.value))} placeholder="2" />
              </label>

              <label className="fld">
                <span>CHUCK / TABLE SIZE</span>
                <input className="in" type="text" value={chuckOrTableSize} onChange={e => setChuckOrTableSize(e.target.value)} placeholder="250mm 3-Jaw Chuck" />
              </label>

              <label className="fld">
                <span>SPINDLE SPEED MIN (RPM)</span>
                <input className="in" type="number" value={spindleSpeedMin} onChange={e => setSpindleSpeedMin(parseInt(e.target.value))} placeholder="0" />
              </label>

              <label className="fld">
                <span>SPINDLE SPEED MAX (RPM)</span>
                <input className="in" type="number" value={spindleSpeedMax} onChange={e => setSpindleSpeedMax(parseInt(e.target.value))} placeholder="4500" />
              </label>

              <label className="fld">
                <span>CONTROLLER BRAND</span>
                <select className="in" value={controllerBrand} onChange={e => setControllerBrand(e.target.value)}>
                  <option value="FANUC 0i-TF">FANUC 0i-TF / 0i-MF</option>
                  <option value="Siemens 828D">Siemens Sinumerik 828D</option>
                  <option value="Mitsubishi M80">Mitsubishi M80</option>
                  <option value="Heidenhain TNC 640">Heidenhain TNC 640</option>
                  <option value="Haas CNC Control">Haas CNC Control</option>
                  <option value="Mazatrol SmoothG">Mazatrol SmoothG</option>
                  <option value="Other">Other</option>
                </select>
              </label>

              <label className="fld">
                <span>SPINDLE SPEED (RPM)</span>
                <input className="in" type="number" value={spindleSpeed} onChange={e => setSpindleSpeed(parseInt(e.target.value))} placeholder="4500" />
              </label>

              <label className="fld">
                <span>SPINDLE POWER (KW)</span>
                <input className="in" type="number" step="0.1" value={spindlePower} onChange={e => setSpindlePower(parseFloat(e.target.value))} placeholder="11.0" />
              </label>

              <label className="fld">
                <span>TOOL CAPACITY / ATC SLOTS</span>
                <input className="in" type="text" placeholder="12 Station Turret / 24 ATC" value={toolCapacity} onChange={e => setToolCapacity(e.target.value)} />
              </label>

              <label className="fld">
                <span>MAX MACHINING DIA (MM)</span>
                <input className="in" type="number" value={maxMachiningDia} onChange={e => setMaxMachiningDia(parseFloat(e.target.value))} placeholder="320" />
              </label>

              <label className="fld">
                <span>MAX MACHINING LENGTH (MM)</span>
                <input className="in" type="number" value={maxMachiningLength} onChange={e => setMaxMachiningLength(parseFloat(e.target.value))} placeholder="500" />
              </label>

              <label className="fld">
                <span>X AXIS TRAVEL (MM)</span>
                <input className="in" type="number" value={xAxisTravel} onChange={e => setXAxisTravel(parseFloat(e.target.value))} placeholder="200" />
              </label>

              <label className="fld">
                <span>Y AXIS TRAVEL (MM)</span>
                <input className="in" type="number" value={yAxisTravel} onChange={e => setYAxisTravel(parseFloat(e.target.value))} placeholder="0" />
              </label>

              <label className="fld">
                <span>Z AXIS TRAVEL (MM)</span>
                <input className="in" type="number" value={zAxisTravel} onChange={e => setZAxisTravel(parseFloat(e.target.value))} placeholder="520" />
              </label>

              <label className="fld">
                <span>RAPID TRAVERSE RATE (M/MIN)</span>
                <input className="in" type="number" value={rapidTraverse} onChange={e => setRapidTraverse(parseFloat(e.target.value))} placeholder="30" />
              </label>
            </div>
          </div>

          {/* SECTION 3: Tailstock & Auxiliary Features */}
          <div className="sec-head">
            <div className="sec-title">
              <span className="material-symbols-rounded">hardware</span>
              <span>3. Tailstock & Auxiliary Features</span>
            </div>
          </div>

          <div className="sec-body" style={{ background: '#fff', border: '1px solid #bfdbfe', borderRadius: '0 0 12px 12px', padding: '24px', marginBottom: '24px' }}>
            <div className="fgrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
              <label className="fld">
                <span>TAILSTOCK TYPE</span>
                <select className="in" value={tailstockType} onChange={e => setTailstockType(e.target.value)}>
                  <option value="Hydraulic Programmable">Hydraulic Programmable</option>
                  <option value="Manual Tailstock">Manual Tailstock</option>
                  <option value="Pneumatic Tailstock">Pneumatic Tailstock</option>
                  <option value="Servo Driven">Servo Driven</option>
                  <option value="None">None</option>
                </select>
              </label>

              <label className="fld">
                <span>TAILSTOCK STROKE (MM)</span>
                <input className="in" type="number" value={tailstockStroke} onChange={e => setTailstockStroke(parseFloat(e.target.value))} placeholder="100" />
              </label>

              <label className="fld">
                <span>QUILL DIAMETER (MM)</span>
                <input className="in" type="number" value={quillDiameter} onChange={e => setQuillDiameter(parseFloat(e.target.value))} placeholder="75" />
              </label>

              <label className="fld">
                <span>QUILL TAPER</span>
                <select className="in" value={quillTaper} onChange={e => setQuillTaper(e.target.value)}>
                  <option value="MT4">MT4</option>
                  <option value="MT5">MT5</option>
                  <option value="MT6">MT6</option>
                  <option value="MT3">MT3</option>
                  <option value="None">None</option>
                </select>
              </label>

              <label className="fld">
                <span>COOLANT TANK CAPACITY (L)</span>
                <input className="in" type="number" value={coolantCapacity} onChange={e => setCoolantCapacity(parseFloat(e.target.value))} placeholder="150" />
              </label>

              <label className="fld">
                <span>MAINTENANCE REF</span>
                <input className="in" type="text" placeholder="PM-SCH-01" value={maintenanceRef} onChange={e => setMaintenanceRef(e.target.value)} />
              </label>

              <label className="fld">
                <span>SKILL REQUIRED</span>
                <input className="in" type="text" placeholder="Level 3 CNC Operator" value={skillReq} onChange={e => setSkillReq(e.target.value)} />
              </label>

              <label className="fld span2">
                <span>PROGRAM REFERENCE</span>
                <input className="in" type="text" placeholder="CNC-LATHE-01" value={programRef} onChange={e => setProgramRef(e.target.value)} />
              </label>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving...' : 'Save Machine'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setViewMode('LIST')}>
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      <ConfirmActionModal
        open={Boolean(deleteTarget)}
        title={`Delete ${deleteTarget?.code ?? ''}`}
        body="Permanently delete this machine?"
        okLabel="Delete"
        danger
        busy={busy}
        onClose={() => setDeleteTarget(null)}
        onConfirm={del}
      />

      <AuditHistoryDrawer open={auditOpen} entityType="MachineMaster" entityId={auditEntityId} onClose={() => setAuditOpen(false)} />
    </>
  );
}
