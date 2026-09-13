// src/config/screenRegistry.tsx
import { lazy } from 'react';
import type { ComponentType } from 'react';
import ModulePlaceholder from '../components/common/ModulePlaceholder';
import ErrorBoundary from '../components/common/ErrorBoundary';

/** Wraps a lazy screen component with a per-module ErrorBoundary so one module crash doesn't take down the whole app. */
function withErrorBoundary(Loader: React.LazyExoticComponent<ComponentType<any>>): ComponentType<any> {
  return function SafeScreen(props: any) {
    return (
      <ErrorBoundary
        fallback={
          <div style={{ padding: 32, textAlign: 'center' }}>
            <span className="material-symbols-rounded" style={{ fontSize: 40, color: 'var(--red)', display: 'block', margin: '0 auto 8px' }}>error</span>
            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Module Error</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>This module encountered an error. You can try reloading it or continue using other parts of the application.</p>
            <button className="btn btn-sm" onClick={() => window.location.reload()}>Reload App</button>
          </div>
        }
      >
        <Loader {...props} />
      </ErrorBoundary>
    );
  };
}
const DashboardPage = lazy(() => import('../pages/dashboard/DashboardPage'));
const SalesDashboard = lazy(() => import('../pages/sales/dashboard/SalesDashboard'));
const PurchaseDashboard = lazy(() => import('../pages/purchase/dashboard/PurchaseDashboard'));
const PlanningDashboard = lazy(() => import('../pages/planning/dashboard/PlanningDashboard'));
const ProductionDashboard = lazy(() => import('../pages/production/dashboard/ProductionDashboard'));
const ProductionBomFreshScreen = lazy(() => import('../pages/production/bom/ProductionBomScreen'));
const InwardEntryPage = lazy(() => import('../pages/inventory/inward/InwardEntryPage'));
const PoInwardPage = lazy(() => import('../pages/inventory/inward/po-inward/PoInwardPage'));
const StockIssueRequestPage = lazy(() => import('../pages/inventory/stock-issue/stock-issue-request/StockIssueRequestPage'));
const RmIssuePage = lazy(() => import('../pages/inventory/stock-issue/rm-issue/RmIssuePage'));
const GeneralIssuePage = lazy(() => import('../pages/inventory/stock-issue/general-issue/GeneralIssuePage'));
const IssueInternalExternalPage = lazy(() => import('../pages/inventory/stock-issue/issue-internal-external/IssueInternalExternalPage'));
const JoDcPage = lazy(() => import('../pages/inventory/delivery-challan/jo-dc/JoDcPage'));
const GeneralDcPage = lazy(() => import('../pages/inventory/delivery-challan/general-dc/GeneralDcPage'));
const TransferDcPage = lazy(() => import('../pages/inventory/delivery-challan/transfer-dc/TransferDcPage'));
const PurchaseInvoicePage = lazy(() => import('../pages/inventory/supplier-invoice/purchase-invoice/PurchaseInvoicePage'));
const SubcontractInvoicePage = lazy(() => import('../pages/inventory/supplier-invoice/subcontract-invoice/SubcontractInvoicePage'));
const DcReturnPage = lazy(() => import('../pages/inventory/return-management/dc-return/DcReturnPage'));
const InvoiceReturnPage = lazy(() => import('../pages/inventory/return-management/invoice-return/InvoiceReturnPage'));
const StockReturnPage = lazy(() => import('../pages/inventory/return-management/stock-return/StockReturnPage'));
const StockAllotmentPage = lazy(() => import('../pages/inventory/allotment/stock-allotment/StockAllotmentPage'));
const StockReleasePage = lazy(() => import('../pages/inventory/allotment/stock-release/StockReleasePage'));
const StockAmendmentPage = lazy(() => import('../pages/inventory/adjustment/stock-amendment/StockAmendmentPage'));
const PhysicalStockAmendmentPage = lazy(() => import('../pages/inventory/adjustment/physical-stock-amendment/PhysicalStockAmendmentPage'));
const InventoryReportsPage = lazy(() => import('../pages/inventory/reports/InventoryReportsPage'));
const InventoryDashboardPage = lazy(() => import('../pages/inventory/reports/InventoryDashboardPage'));
const InventoryLogPage = lazy(() => import('../pages/inventory/reports/InventoryLogPage'));
const CurrentStockPage = lazy(() => import('../pages/inventory/reports/CurrentStockPage'));
const StoreStockSummaryPage = lazy(() => import('../pages/inventory/reports/StoreStockSummaryPage'));
const TraceabilityViewerPage = lazy(() => import('../pages/inventory/reports/TraceabilityViewerPage'));
const PeriodReportPage = lazy(() => import('../pages/inventory/reports/PeriodReportPage'));
const QualityDashboard = lazy(() => import('../pages/quality/dashboard/QualityDashboard'));
const QualityPage = lazy(() => import('../pages/quality/inspection/QualityPage'));
const IqcInspectionPage = lazy(() => import('../pages/quality/inspection/IqcInspectionPage'));
const LoInspectionPage = lazy(() => import('../pages/quality/inspection/LoInspectionPage'));
const JominInspectionPage = lazy(() => import('../pages/quality/inspection/JominInspectionPage'));
const IpqcInspectionPage = lazy(() => import('../pages/quality/inspection/IpqcInspectionPage'));
const FaiInspectionPage = lazy(() => import('../pages/quality/inspection/FaiInspectionPage'));
const LineInspectionPage = lazy(() => import('../pages/quality/inspection/LineInspectionPage'));
const LastOffInspectionPage = lazy(() => import('../pages/quality/inspection/LastOffInspectionPage'));
const FinalInspectionPage = lazy(() => import('../pages/quality/inspection/FinalInspectionPage'));
const InspectionPendingPage = lazy(() => import('../pages/quality/pending/InspectionPendingPage'));
const CalibrationPage = lazy(() => import('../pages/quality/calibration/CalibrationPage'));
const CalibrationRecordPage = lazy(() => import('../pages/quality/calibration/CalibrationRecordPage'));
const NcrPage = lazy(() => import('../pages/quality/ncr/NcrPage'));
const PurchaseRequestPage = lazy(() => import('../pages/purchase/request/PurchaseRequestPage'));
const SupplierEnquiryPage = lazy(() => import('../pages/purchase/enquiry/SupplierEnquiryPage'));
const SupplierQuotationPage = lazy(() => import('../pages/purchase/quotation/SupplierQuotationPage'));
const QuotationComparisonPage = lazy(() => import('../pages/purchase/quotation/QuotationComparisonPage'));
const PurchaseOrderPage = lazy(() => import('../pages/purchase/order/PurchaseOrderPage'));
const PurchaseReturnPage = lazy(() => import('../pages/purchase/return/PurchaseReturnPage'));
const PoSchedulePage = lazy(() => import('../pages/purchase/schedule/PoSchedulePage'));
const JoSchedulePage = lazy(() => import('../pages/purchase/schedule/JoSchedulePage'));
const JobOrderPage = lazy(() => import('../pages/purchase/job-order/JobOrderPage'));
const PurchaseTargetPage = lazy(() => import('../pages/purchase/target/PurchaseTargetPage'));
const PurchasePriceListPage = lazy(() => import('../pages/purchase/price-list/PurchasePriceListPage'));
const JobWorkPriceListPage = lazy(() => import('../pages/purchase/price-list/JobWorkPriceListPage'));
const SalesOrderPage = lazy(() => import('../pages/sales/order/SalesOrderPage'));
const ProformaInvoicePage = lazy(() => import('../pages/sales/proforma/ProformaInvoicePage'));
const SalesDcSalesPage = lazy(() => import('../pages/sales/dc/SalesDcSalesPage'));
const SalesInvoicePage = lazy(() => import('../pages/sales/invoice/SalesInvoicePage'));
const DcReturnSalesPage = lazy(() => import('../pages/sales/return/dc/DcReturnSalesPage'));
const InvoiceReturnSalesPage = lazy(() => import('../pages/sales/return/invoice/InvoiceReturnSalesPage'));
const SoSchedulePage = lazy(() => import('../pages/sales/schedule/SoSchedulePage'));
const PaymentReceiptPage = lazy(() => import('../pages/sales/payment/PaymentReceiptPage'));
const CreditDebitNotePage = lazy(() => import('../pages/sales/credit-note/CreditDebitNotePage'));
const EnquiryPage = lazy(() => import('../pages/sales/enquiry/EnquiryPage'));
const QuotationPage = lazy(() => import('../pages/sales/quotation/QuotationPage'));
const ConcessionPage = lazy(() => import('../pages/quality/concession/ConcessionPage'));
const InwardTestCertificatePage = lazy(() => import('../pages/quality/certificate/InwardTestCertificatePage'));
const InternalTestCertificatePage = lazy(() => import('../pages/quality/certificate/InternalTestCertificatePage'));
const OutwardTestCertificatePage = lazy(() => import('../pages/quality/certificate/OutwardTestCertificatePage'));
const ComplaintPage = lazy(() => import('../pages/quality/complaint/ComplaintPage'));
const CapaPage = lazy(() => import('../pages/quality/capa/CapaPage'));
const EightDPage = lazy(() => import('../pages/quality/eight-d/EightDPage'));
const TraceabilityPage = lazy(() => import('../pages/quality/traceability/TraceabilityPage'));
const SpcPage = lazy(() => import('../pages/quality/SpcPage'));
const RouteSheetPage = lazy(() => import('../pages/planning/route/RouteSheetPage'));
const WorkOrderPage = lazy(() => import('../pages/planning/workorder/WorkOrderPage'));
const WorkOrderReportsScreen = lazy(() => import('../pages/planning/workorder/WorkOrderReportsScreen'));
const ShopFloorPage = lazy(() => import('../pages/planning/shopfloor/ShopFloorPage'));
const WorkCenterPage = lazy(() => import('../pages/planning/master/WorkCenterPage'));
const OperationPage = lazy(() => import('../pages/planning/master/OperationPage'));
const PartyMasterScreen = lazy(() => import('../pages/master/PartyMasterScreen'));
const LocationMasterScreen = lazy(() => import('../pages/master/LocationMasterScreen'));
const ItemMasterScreen = lazy(() => import('../pages/master/ItemMasterScreen'));
const MaterialPlanningScreen = lazy(() => import('../pages/planning/material-planning/MaterialPlanningScreen'));
const DispatchPlanScreen = lazy(() => import('../pages/planning/dispatch-plan/DispatchPlanScreen'));
const MachineLoadScreen = lazy(() => import('../pages/planning/machine-load/MachineLoadScreen'));
const MachineLoadGantt = lazy(() => import('../pages/planning/machine-load/MachineLoadGantt'));
const ResourceMasterScreen = lazy(() => import('../pages/master/resource/ResourceMasterScreen'));
const BomMasterScreen = lazy(() => import('../pages/master/bom/BomMasterScreen'));
const EcrScreen = lazy(() => import('../pages/planning/ecr/EcrScreen'));
const GapAnalysisScreen = lazy(() => import('../pages/planning/gap-analysis/GapAnalysisScreen'));
const CostEstimationScreen = lazy(() => import('../pages/planning/cost-estimation/CostEstimationScreen'));
const FgPossibleScreen = lazy(() => import('../pages/planning/fg-possible/FgPossibleScreen'));
const JobCardScreen = lazy(() => import('../pages/production/job-card/JobCardScreen'));
const ProductionOrderScreen = lazy(() => import('../pages/production/order/ProductionOrderScreen'));
const JobCardKanban = lazy(() => import('../pages/production/kanban/JobCardKanban'));
const ProductionEntryScreen = lazy(() => import('../pages/production/production-entry/ProductionEntryScreen'));
const ProductConversionScreen = lazy(() => import('../pages/production/product-conversion/ProductConversionScreen'));
const ProductionReturnScreen = lazy(() => import('../pages/production/production-return/ProductionReturnScreen'));
const ProductionRejectionsScreen = lazy(() => import('../pages/production/disposition/ProductionDispositionScreen').then((m) => ({ default: m.ProductionRejectionsScreen })));
const ProductionScrapsScreen = lazy(() => import('../pages/production/disposition/ProductionDispositionScreen').then((m) => ({ default: m.ProductionScrapsScreen })));
const ProductionReworksScreen = lazy(() => import('../pages/production/disposition/ProductionDispositionScreen').then((m) => ({ default: m.ProductionReworksScreen })));
const BatchCardScreen = lazy(() => import('../pages/production/batch-card/BatchCardScreen'));
const ProductionQualityGateScreen = lazy(() => import('../pages/production/quality-gate/ProductionQualityGateScreen'));
const MaterialRequestScreen = lazy(() => import('../pages/production/material-request/MaterialRequestScreen'));
const ConsumptionScreen = lazy(() => import('../pages/production/consumption/ConsumptionScreen'));
const ProductionLogScreen = lazy(() => import('../pages/production/production-log/ProductionLogScreen'));
const IdleTimeScreen = lazy(() => import('../pages/production/idle-time/IdleTimeScreen'));
const ToolLifeScreen = lazy(() => import('../pages/production/tool-life/ToolLifeScreen'));
const ProductionPendingScreen = lazy(() => import('../pages/production/production-pending/ProductionPendingScreen'));
const ProductionReportsScreen = lazy(() => import('../pages/production/reports/ProductionReportsScreen'));
const ProductionOutputScreen = lazy(() => import('../pages/production/reports/ProductionOutputScreen'));
const ProductionRejectionScreen = lazy(() => import('../pages/production/reports/ProductionRejectionScreen'));
const MaintenanceDashboard = lazy(() => import('../pages/maintenance/dashboard/MaintenanceDashboard'));
const MaintenanceMastersPage = lazy(() => import('../pages/maintenance/masters/MaintenanceMastersPage'));
const BreakdownIntimationScreen = lazy(() => import('../pages/maintenance/breakdown/BreakdownIntimationScreen'));
const BreakdownRectificationScreen = lazy(() => import('../pages/maintenance/breakdown/BreakdownRectificationScreen'));
const PmPlanScreen = lazy(() => import('../pages/maintenance/pm/PmPlanScreen'));
const PmScheduleScreen = lazy(() => import('../pages/maintenance/pm/PmScheduleScreen'));
const PmCompletionScreen = lazy(() => import('../pages/maintenance/pm/PmCompletionScreen'));
const ToolServiceIntimationScreen = lazy(() => import('../pages/maintenance/tools/ToolServiceIntimationScreen'));
const ToolServiceRectificationScreen = lazy(() => import('../pages/maintenance/tools/ToolServiceRectificationScreen'));
const CalibrationScheduleScreen = lazy(() => import('../pages/maintenance/calibration/CalibrationScheduleScreen'));
const CalibrationEntryScreen = lazy(() => import('../pages/maintenance/calibration/CalibrationEntryScreen'));
const PowerConsumptionScreen = lazy(() => import('../pages/maintenance/utilities/PowerConsumptionScreen'));
const WaterConsumptionScreen = lazy(() => import('../pages/maintenance/utilities/WaterConsumptionScreen'));
const RootCauseAnalysisScreen = lazy(() => import('../pages/maintenance/analysis/RootCauseAnalysisScreen'));
const MaintenanceAnalysisScreen = lazy(() => import('../pages/maintenance/analysis/MaintenanceAnalysisScreen'));
const PmWorkOrderScreen = lazy(() => import('../pages/maintenance/pm/PmWorkOrderScreen'));
const SpareRequestScreen = lazy(() => import('../pages/maintenance/spare/SpareRequestScreen'));
const MaintenanceCostScreen = lazy(() => import('../pages/maintenance/cost/MaintenanceCostScreen'));
const MaintenanceReportsScreen = lazy(() => import('../pages/maintenance/reports/MaintenanceReportsScreen'));
const DowntimeCostReportPage = lazy(() => import('../pages/maintenance/reports/DowntimeCostReportPage'));
const NotificationLogPage = lazy(() => import('../pages/maintenance/notifications/NotificationLogPage'));
const CompanyInfoScreen = lazy(() => import('../pages/master/company-info/CompanyInfoScreen'));
const UOMScreen = lazy(() => import('../pages/master/uom/UOMScreen'));
const ItemGroupScreen = lazy(() => import('../pages/master/item-group/ItemGroupScreen'));
const StoreScreen = lazy(() => import('../pages/master/store/StoreScreen'));
const ProcessGroupScreen = lazy(() => import('../pages/master/process-group/ProcessGroupScreen'));
const ProcessScreen = lazy(() => import('../pages/master/process/ProcessScreen'));
const MachineScreen = lazy(() => import('../pages/master/machine/MachineScreen'));
const MachineCapabilityScreen = lazy(() => import('../pages/master/machine-capability/MachineCapabilityScreen'));
const InstrumentScreen = lazy(() => import('../pages/master/instrument/InstrumentScreen'));
const OperatorScreen = lazy(() => import('../pages/master/operator/OperatorScreen'));
const DrawingRevisionScreen = lazy(() => import('../pages/master/drawing-revision/DrawingRevisionScreen'));
const ToolScreen = lazy(() => import('../pages/master/tool/ToolScreen'));
const SubcontractorScreen = lazy(() => import('../pages/master/subcontractor/SubcontractorScreen'));
const PurchasableItemScreen = lazy(() => import('../pages/master/items/purchasable/PurchasableItemScreen'));
const CustomerSuppliedItemScreen = lazy(() => import('../pages/master/items/customer-supplied/CustomerSuppliedItemScreen'));
const ManufacturingItemScreen = lazy(() => import('../pages/master/items/manufacturing/ManufacturingItemScreen'));
const CustomerListScreen = lazy(() => import('../pages/master/customers/CustomerListScreen'));
const SupplierListScreen = lazy(() => import('../pages/master/suppliers/SupplierListScreen'));
const UserScreen = lazy(() => import('../pages/master/users/UserScreen'));
const AccessControlPanel = lazy(() => import('../pages/admin/access/AccessControlPanel'));
const RackScreen = lazy(() => import('../pages/master/rack/RackScreen'));
const BinScreen = lazy(() => import('../pages/master/bin/BinScreen'));
const NumberingConfigPage = lazy(() => import('../pages/master/numbering-config/NumberingConfigPage'));
const PlantMasterPage = lazy(() => import('../pages/PlantMasterPage'));
const WorkCenterMasterPage = lazy(() => import('../pages/WorkCenterMasterPage'));
const SparePartMasterPage = lazy(() => import('../pages/SparePartMasterPage'));
const MeterMasterPage = lazy(() => import('../pages/MeterMasterPage'));
const SamplingPlanPage = lazy(() => import('../pages/SamplingPlanPage'));
const InspectionPlanPage = lazy(() => import('../pages/InspectionPlanPage'));
const OeePage = lazy(() => import('../pages/OeePage'));
const SupplierScorecardPage = lazy(() => import('../pages/quality/SupplierScorecardPage'));
const CostRollupPage = lazy(() => import('../pages/maintenance/CostRollupPage'));


export interface ScreenDefinition {
  component: ComponentType<any>;
}

export const SCREEN_REGISTRY: Record<string, ScreenDefinition> = Object.fromEntries(
  Object.entries({
    dashboard: DashboardPage,
    'sales-dashboard': SalesDashboard,
    'purchase-dashboard': PurchaseDashboard,
    'planning-dashboard': PlanningDashboard,
    'production-dashboard': ProductionDashboard,
    'production-bom-fresh': ProductionBomFreshScreen,
    'inward-entry': InwardEntryPage,
    'po-inward': PoInwardPage,
    'stock-issue-request': StockIssueRequestPage,
    'rm-issue': RmIssuePage,
    'general-issue': GeneralIssuePage,
    'issue-internal-external': IssueInternalExternalPage,
    'jo-dc': JoDcPage,
    'general-dc': GeneralDcPage,
    'transfer-dc': TransferDcPage,
    'purchase-invoice': PurchaseInvoicePage,
    'subcontract-invoice': SubcontractInvoicePage,
    'dc-return': DcReturnPage,
    'invoice-return': InvoiceReturnPage,
    'stock-return': StockReturnPage,
    'stock-allotment': StockAllotmentPage,
    'stock-release': StockReleasePage,
    'stock-amendment': StockAmendmentPage,
    'physical-stock-amendment': PhysicalStockAmendmentPage,
    reports: InventoryReportsPage,
    'inventory-dashboard': InventoryDashboardPage,
    'inventory-log': InventoryLogPage,
    'current-stock': CurrentStockPage,
    'store-stock-summary': StoreStockSummaryPage,
    'traceability-viewer': TraceabilityViewerPage,
    'inventory-period-report': PeriodReportPage,
    'quality-dashboard': QualityDashboard,
    'quality-inspection': QualityPage,
    'quality-ncr': NcrPage,
    'inspection-pending': InspectionPendingPage,
    'inward-inspection-iqc': IqcInspectionPage,
    'lo-inspection': LoInspectionPage,
    'jomin-inspection': JominInspectionPage,
    'process-inspection-ipqc': IpqcInspectionPage,
    'first-inspection': FaiInspectionPage,
    'line-inspection': LineInspectionPage,
    'last-off-inspection': LastOffInspectionPage,
    'final-inspection': FinalInspectionPage,
    'inward-test-certificate': InwardTestCertificatePage,
    'internal-test-certificate': InternalTestCertificatePage,
    'outward-test-certificate': OutwardTestCertificatePage,
    'concession-entry': ConcessionPage,
    'customer-complaint': ComplaintPage,
    capa: CapaPage,
    'eight-d-report': EightDPage,
    traceability: TraceabilityPage,
    'quality-spc': SpcPage,
    calibration: CalibrationPage,
    'calibration-record': CalibrationRecordPage,
    'purchase-request': PurchaseRequestPage,
    'supplier-enquiry': SupplierEnquiryPage,
    'supplier-quotation': SupplierQuotationPage,
    'quotation-comparison': QuotationComparisonPage,
    'purchase-order': PurchaseOrderPage,
    'purchase-return': PurchaseReturnPage,
    'po-schedule': PoSchedulePage,
    'jo-schedule': JoSchedulePage,
    'job-order': JobOrderPage,
    'purchase-target': PurchaseTargetPage,
    'purchase-price-list': PurchasePriceListPage,
    'job-work-price-list': JobWorkPriceListPage,
    'sales-order': SalesOrderPage,
    'proforma-invoice': ProformaInvoicePage,
    'sales-sales-dc': SalesDcSalesPage,
    'sales-invoice': SalesInvoicePage,
    'sales-schedule': SoSchedulePage,
    'sales-dc-return': DcReturnSalesPage,
    'sales-invoice-return': InvoiceReturnSalesPage,
    'payment-receipt': PaymentReceiptPage,
    'credit-debit-note': CreditDebitNotePage,
    'enquiry': EnquiryPage,
    'quotation': QuotationPage,
    'production-bom': ProductionBomFreshScreen,
    'route-sheet': RouteSheetPage,
    'work-order': WorkOrderPage,
    'work-order-reports': WorkOrderReportsScreen,
    'shop-floor-entry': ShopFloorPage,
    'work-center': WorkCenterPage,
    'machine-master': MachineScreen,
    'machine-capability': MachineCapabilityScreen,
    'operation-master': OperationPage,
    'party-master': PartyMasterScreen,
    'location-master': LocationMasterScreen,
    'item-master': ItemMasterScreen,
    'material-planning': MaterialPlanningScreen,
    'dispatch-plan': DispatchPlanScreen,
    'machine-load': MachineLoadScreen,
    'machine-load-gantt': MachineLoadGantt,
    'resource-master': ResourceMasterScreen,
    'bom-master': BomMasterScreen,
    'engineering-change': EcrScreen,
    'gap-analysis': GapAnalysisScreen,
    'cost-estimation': CostEstimationScreen,
    'fg-possible': FgPossibleScreen,
    'job-card': JobCardScreen,
    'production-order': ProductionOrderScreen,
    'job-card-kanban': JobCardKanban,
    'production-entry': ProductionEntryScreen,
    'product-conversion': ProductConversionScreen,
    'production-return': ProductionReturnScreen,
    'production-rejections': ProductionRejectionsScreen,
    'production-scraps': ProductionScrapsScreen,
    'production-reworks': ProductionReworksScreen,
    'batch-card': BatchCardScreen,
    'production-quality-gate': ProductionQualityGateScreen,
    'material-request': MaterialRequestScreen,
    'consumption': ConsumptionScreen,
    'production-log': ProductionLogScreen,
    'idle-time': IdleTimeScreen,
    'tool-life': ToolLifeScreen,
    'production-pending': ProductionPendingScreen,
    'production-reports': ProductionReportsScreen,
    'production-output': ProductionOutputScreen,
    'production-rejection': ProductionRejectionScreen,
    'maintenance-dashboard': MaintenanceDashboard,
    'maintenance-masters': MaintenanceMastersPage,
    'breakdown-intimation': BreakdownIntimationScreen,
    'breakdown-rectification': BreakdownRectificationScreen,
    'pm-plan': PmPlanScreen,
    'pm-schedule': PmScheduleScreen,
    'pm-completion': PmCompletionScreen,
    'pm-work-order': PmWorkOrderScreen,
    'tool-service-intimation': ToolServiceIntimationScreen,
    'tool-service-rectification': ToolServiceRectificationScreen,
    'calibration-schedule': CalibrationScheduleScreen,
    'calibration-entry': CalibrationEntryScreen,
    'power-consumption': PowerConsumptionScreen,
    'water-consumption': WaterConsumptionScreen,
    rca: RootCauseAnalysisScreen,
    'maintenance-analysis-view': MaintenanceAnalysisScreen,
    'maintenance-reports': MaintenanceReportsScreen,
    'downtime-cost-report': DowntimeCostReportPage,
    'notification-log': NotificationLogPage,
    'spare-request': SpareRequestScreen,
    'maintenance-cost': MaintenanceCostScreen,
    'company-info': CompanyInfoScreen,
    'uom-master': UOMScreen,
    'item-group-master': ItemGroupScreen,
    'store-master': StoreScreen,
    'rack-master': RackScreen,
    'bin-master': BinScreen,
    'process-group-master': ProcessGroupScreen,
    'process-master': ProcessScreen,
    'instrument-master': InstrumentScreen,
    'operator-master': OperatorScreen,
    'drawing-revision-master': DrawingRevisionScreen,
    'tool-master': ToolScreen,
    'subcontractor-master': SubcontractorScreen,
    'purchasable-item': PurchasableItemScreen,
    'customer-supplied-item': CustomerSuppliedItemScreen,
    'manufacturing-item': ManufacturingItemScreen,
    'customer-list': CustomerListScreen,
    'supplier-list': SupplierListScreen,
    'user-management': UserScreen,
    'access-control': AccessControlPanel,
    'numbering-config': NumberingConfigPage,
    'plant-master': PlantMasterPage,
    'work-center-master': WorkCenterMasterPage,
    'spare-part-master': SparePartMasterPage,
    'meter-master': MeterMasterPage,
    'sampling-plan': SamplingPlanPage,
    'inspection-plan': InspectionPlanPage,
    oee: OeePage,
    'supplier-scorecard': SupplierScorecardPage,
    'machine-costs': CostRollupPage,
  }).map(([id, component]) => [id, { component: withErrorBoundary(component) }])
) as Record<string, ScreenDefinition>;



export function getScreenComponent(screenId: string): ComponentType<any> {
  return SCREEN_REGISTRY[screenId]?.component ?? ModulePlaceholder;
}