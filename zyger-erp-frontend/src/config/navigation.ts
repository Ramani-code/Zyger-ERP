export interface NavHeadingNode {
  type: 'heading';
  id: string;
  label: string;
  icon?: string;
}

export interface NavLeafNode {
  type: 'item';
  id: string;
  label: string;
  icon?: string;
  tabIcon?: string;
  screenId?: string;
}

export interface NavGroupNode {
  type: 'group';
  id: string;
  label: string;
  icon?: string;
  children: NavNode[];
}

export type NavNode = NavHeadingNode | NavLeafNode | NavGroupNode;

export interface NavTopItem {
  id: string;
  label: string;
  icon: string;
  screenId?: string;
  align?: 'left' | 'right';
  children?: NavNode[];
}

export const NAV_ITEMS: NavTopItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'space_dashboard',
    screenId: 'dashboard',
  },

  {
    id: 'master',
    label: 'Master',


    icon: 'database',
    children: [
      {
        type: 'group',
        id: 'master-inventory',
        label: 'Inventory',
        icon: 'inventory_2',
        children: [
          { type: 'heading', id: 'master-inventory-heading', label: 'INVENTORY', icon: 'inventory_2' },
          {
            type: 'group',
            id: 'master-items',
            label: 'Items',
            icon: 'category',
            children: [
              { type: 'item', id: 'purchasable-item', label: 'Purchasable Item', icon: 'shopping_cart', screenId: 'purchasable-item', tabIcon: 'shopping_cart' },
              { type: 'item', id: 'customer-supplied-item', label: 'Customer Supplied', icon: 'local_shipping', screenId: 'customer-supplied-item', tabIcon: 'local_shipping' },
              { type: 'item', id: 'manufacturing-item', label: 'Manufacturing Item', icon: 'precision_manufacturing', screenId: 'manufacturing-item', tabIcon: 'precision_manufacturing' },
            ],
          },
          { type: 'item', id: 'item-group-master', label: 'Item Group', icon: 'folder_special', screenId: 'item-group-master', tabIcon: 'folder_special' },
          { type: 'item', id: 'store-master', label: 'Store Master', icon: 'warehouse', screenId: 'store-master', tabIcon: 'warehouse' },
          {
            type: 'group',
            id: 'master-configurations',
            label: 'Configurations',
            icon: 'settings_suggest',
            children: [
              { type: 'item', id: 'process-master', label: 'Process', icon: 'factory', screenId: 'process-master', tabIcon: 'factory' },
              { type: 'item', id: 'process-group-master', label: 'Process Group', icon: 'topic', screenId: 'process-group-master', tabIcon: 'topic' },
            ],
          },
          { type: 'item', id: 'uom-master', label: 'UOM', icon: 'straighten', screenId: 'uom-master', tabIcon: 'straighten' },
        ],
      },
      {
        type: 'item',
        id: 'customer-list',
        label: 'Customer List',
        icon: 'contacts',
        screenId: 'customer-list',
        tabIcon: 'contacts',
      },
      {
        type: 'item',
        id: 'supplier-list',
        label: 'Supplier List',
        icon: 'local_shipping',
        screenId: 'supplier-list',
        tabIcon: 'local_shipping',
      },
      {
        type: 'item',
        id: 'subcontractor-master',
        label: 'Subcontractor List',
        icon: 'engineering',
        screenId: 'subcontractor-master',
        tabIcon: 'engineering',
      },
      {
        type: 'item',
        id: 'master-bom',
        label: 'Bill of Material (BOM)',
        icon: 'account_tree',
        screenId: 'bom-master',
        tabIcon: 'account_tree',
      },
      {
        type: 'group',
        id: 'master-assets',
        label: 'Assets',
        icon: 'precision_manufacturing',
        children: [
          { type: 'heading', id: 'master-assets-heading', label: 'ASSETS', icon: 'precision_manufacturing' },
          { type: 'item', id: 'machine-master', label: 'Machine Master', icon: 'precision_manufacturing', screenId: 'machine-master', tabIcon: 'precision_manufacturing' },
          { type: 'item', id: 'machine-capability', label: 'Machine Capability Matrix', icon: 'rule', screenId: 'machine-capability', tabIcon: 'rule' },
          { type: 'item', id: 'instrument-master', label: 'Instrument Master', icon: 'science', screenId: 'instrument-master', tabIcon: 'science' },
          { type: 'item', id: 'tool-master', label: 'Tools Master', icon: 'build', screenId: 'tool-master', tabIcon: 'build' },
          { type: 'item', id: 'operator-master', label: 'Operator Master', icon: 'engineering', screenId: 'operator-master', tabIcon: 'engineering' },
          { type: 'item', id: 'drawing-revision-master', label: 'Drawing & Revision Master', icon: 'design_services', screenId: 'drawing-revision-master', tabIcon: 'design_services' },
        ],
      },
      {
        type: 'item',
        id: 'admin-user-management',
        label: 'User Management',
        icon: 'manage_accounts',
        screenId: 'user-management',
        tabIcon: 'manage_accounts',
      },
      {
        type: 'item',
        id: 'access-control',
        label: 'Access Control',
        icon: 'tune',
        screenId: 'access-control',
        tabIcon: 'tune',
      },
      {
        type: 'item',
        id: 'company-info',
        label: 'Company Info',
        icon: 'business',
        screenId: 'company-info',
        tabIcon: 'business',
      },
      {
        type: 'item',
        id: 'numbering-config',
        label: 'Numbering Config',
        icon: 'format_list_numbered',
        screenId: 'numbering-config',
        tabIcon: 'format_list_numbered',
      },
      {
        type: 'group',
        id: 'master-production-v2',
        label: 'Production Masters',
        icon: 'precision_manufacturing',
        children: [
          { type: 'heading', id: 'master-production-v2-heading', label: 'PRODUCTION MASTERS', icon: 'precision_manufacturing' },
          { type: 'item', id: 'plant-master', label: 'Plant Master', icon: 'apartment', screenId: 'plant-master', tabIcon: 'apartment' },
          { type: 'item', id: 'work-center-master', label: 'Work Centers', icon: 'domain', screenId: 'work-center-master', tabIcon: 'domain' },
          { type: 'item', id: 'meter-master', label: 'Meters', icon: 'speed', screenId: 'meter-master', tabIcon: 'speed' },
          { type: 'item', id: 'spare-part-master', label: 'Spare Parts', icon: 'settings_suggest', screenId: 'spare-part-master', tabIcon: 'settings_suggest' },
          { type: 'item', id: 'sampling-plan', label: 'Sampling Plans', icon: 'rule', screenId: 'sampling-plan', tabIcon: 'rule' },
          { type: 'item', id: 'inspection-plan', label: 'Inspection Plans', icon: 'checklist', screenId: 'inspection-plan', tabIcon: 'checklist' },
          { type: 'item', id: 'oee', label: 'OEE Dashboard', icon: 'monitoring', screenId: 'oee', tabIcon: 'monitoring' },
          { type: 'item', id: 'supplier-scorecard', label: 'Supplier Scorecard', icon: 'grade', screenId: 'supplier-scorecard', tabIcon: 'grade' },
          { type: 'item', id: 'resource-master', label: 'Resource Master', icon: 'precision_manufacturing', screenId: 'resource-master', tabIcon: 'precision_manufacturing' },
          { type: 'item', id: 'machine-costs', label: 'Machine Costs (TCO)', icon: 'payments', screenId: 'machine-costs', tabIcon: 'payments' },
        ],
      },
    ],
  },

  {
    id: 'sales',
    label: 'Sales',
    icon: 'point_of_sale',
    children: [
      {
        type: 'item',
        id: 'sales-dashboard',
        label: 'Sales Dashboard',
        icon: 'space_dashboard',
        screenId: 'sales-dashboard',
        tabIcon: 'space_dashboard',
      },
      {
        type: 'item',
        id: 'enquiry',
        label: 'Enquiry / RFQ',
        icon: 'contact_support',
        screenId: 'enquiry',
      },
      {
        type: 'item',
        id: 'quotation',
        label: 'Quotation (Costed)',
        icon: 'request_quote',
        screenId: 'quotation',
      },
      {
        type: 'item',
        id: 'sales-order',
        label: 'Sales Order',
        icon: 'shopping_cart',
        screenId: 'sales-order',
      },
      {
        type: 'item',
        id: 'proforma-invoice',
        label: 'Proforma Invoice (PI)',
        icon: 'request_quote',
        screenId: 'proforma-invoice',
      },
      {
        type: 'item',
        id: 'sales-sales-dc',
        label: 'Sales DC',
        icon: 'local_shipping',
        screenId: 'sales-sales-dc',
        tabIcon: 'local_shipping',
      },
      {
        type: 'item',
        id: 'sales-invoice',
        label: 'Sales Invoice',
        icon: 'receipt_long',
        screenId: 'sales-invoice',
      },
      {
        type: 'item',
        id: 'sales-schedule',
        label: 'SO Schedule',
        icon: 'calendar_month',
        screenId: 'sales-schedule',
      },
      {
        type: 'item',
        id: 'payment-receipt',
        label: 'Payment Collection',
        icon: 'payments',
        screenId: 'payment-receipt',
      },
      {
        type: 'item',
        id: 'credit-debit-note',
        label: 'Credit / Debit Note',
        icon: 'difference',
        screenId: 'credit-debit-note',
      },
      {
        type: 'group',
        id: 'sales-customer-return',
        label: 'Customer Return',
        icon: 'assignment_return',
        children: [
          {
            type: 'heading',
            id: 'sales-customer-return-heading',
            label: 'CUSTOMER RETURN',
            icon: 'assignment_return',
          },
          {
            type: 'item',
            id: 'sales-customer-return-dc-return',
            label: 'DC Return',
            icon: 'keyboard_return',
            screenId: 'sales-dc-return',
            tabIcon: 'assignment_return',
          },
          {
            type: 'item',
            id: 'sales-customer-return-invoice-return',
            label: 'Invoice Return',
            icon: 'receipt_long',
            screenId: 'sales-invoice-return',
            tabIcon: 'assignment_return',
          },
        ],
      },
    ],
  },

  {
    id: 'purchase',
    label: 'Purchase',
    icon: 'shopping_bag',
    children: [
      {
        type: 'item',
        id: 'purchase-dashboard',
        label: 'Purchase Dashboard',
        icon: 'space_dashboard',
        screenId: 'purchase-dashboard',
        tabIcon: 'space_dashboard',
      },
      {
        type: 'item',
        id: 'purchase-request',
        label: 'Purchase Request',
        icon: 'assignment',
        screenId: 'purchase-request',
      },
      {
        type: 'item',
        id: 'supplier-enquiry',
        label: 'Supplier Enquiry',
        icon: 'mark_email_unread',
        screenId: 'supplier-enquiry',
      },
      {
        type: 'item',
        id: 'supplier-quotation',
        label: 'Supplier Quotation',
        icon: 'request_quote',
        screenId: 'supplier-quotation',
      },
      {
        type: 'item',
        id: 'quotation-comparison',
        label: 'Quotation Comparison',
        icon: 'compare_arrows',
        screenId: 'quotation-comparison',
      },
      {
        type: 'item',
        id: 'purchase-order',
        label: 'Purchase Order (PO)',
        icon: 'shopping_cart_checkout',
        screenId: 'purchase-order',
      },
      {
        type: 'item',
        id: 'purchase-return',
        label: 'Purchase Return',
        icon: 'assignment_return',
        screenId: 'purchase-return',
      },
      {
        type: 'group',
        id: 'purchase-schedule',
        label: 'Purchase Schedule',
        icon: 'calendar_month',
        children: [
          {
            type: 'heading',
            id: 'purchase-schedule-heading',
            label: 'PURCHASE SCHEDULE',
            icon: 'calendar_month',
          },
          {
            type: 'item',
            id: 'po-schedule',
            label: 'PO Schedule',
            icon: 'event_note',
            screenId: 'po-schedule',
          },
          {
            type: 'item',
            id: 'jo-schedule',
            label: 'JO Schedule',
            icon: 'event_repeat',
            screenId: 'jo-schedule',
          },
        ],
      },
      {
        type: 'item',
        id: 'job-order',
        label: 'Job Order (JO)',
        icon: 'assignment_turned_in',
        screenId: 'job-order',
      },
      {
        type: 'item',
        id: 'purchase-target',
        label: 'Purchase Target',
        icon: 'track_changes',
        screenId: 'purchase-target',
      },
    ],
  },

  {
    id: 'inventory',
    label: 'Inventory',
    icon: 'inventory',
    children: [
      {
        type: 'item',
        id: 'inventory-dashboard',
        label: 'Dashboard',
        icon: 'space_dashboard',
        screenId: 'inventory-dashboard',
        tabIcon: 'space_dashboard',
      },

      {
        type: 'item',
        id: 'inward-entry',
        label: 'Inward Entry',
        icon: 'move_to_inbox',
        screenId: 'inward-entry',
        tabIcon: 'move_to_inbox',
      },

      {
        type: 'item',
        id: 'stock-issue-request',
        label: 'Stock Issue Request',
        icon: 'assignment',
        screenId: 'stock-issue-request',
      },

      {
        type: 'group',
        id: 'inventory-stock-issue',
        label: 'Stock Issue',
        icon: 'outbox',
        children: [
          {
            type: 'heading',
            id: 'inventory-stock-issue-heading',
            label: 'STOCK ISSUE',
            icon: 'outbox',
          },
          {
            type: 'item',
            id: 'rm-issue',
            label: 'RM Issue',
            screenId: 'rm-issue',
            tabIcon: 'outbox',
          },
          {
            type: 'item',
            id: 'issue-internal-external',
            label: 'Issue Internal / External',
            icon: 'outbox',
            screenId: 'issue-internal-external',
            tabIcon: 'outbox',
          },
        ],
      },

      {
        type: 'group',
        id: 'inventory-delivery-challan',
        label: 'Delivery Challan',
        icon: 'local_shipping',
        children: [
          {
            type: 'heading',
            id: 'inventory-delivery-challan-heading',
            label: 'DELIVERY CHALLAN',
            icon: 'local_shipping',
          },
          {
            type: 'item',
            id: 'inventory-jo-dc',
            label: 'JO DC',
            screenId: 'jo-dc',
            tabIcon: 'local_shipping',
          },
          {
            type: 'item',
            id: 'general-dc',
            label: 'General DC',
            screenId: 'general-dc',
            tabIcon: 'local_shipping',
          },
          {
            type: 'item',
            id: 'transfer-dc',
            label: 'Transfer DC',
            screenId: 'transfer-dc',
            tabIcon: 'local_shipping',
          },
        ],
      },

      {
        type: 'group',
        id: 'inventory-return-management',
        label: 'Return Management',
        icon: 'assignment_return',
        children: [
          {
            type: 'heading',
            id: 'inventory-return-management-heading',
            label: 'RETURN MANAGEMENT',
            icon: 'assignment_return',
          },
          {
            type: 'item',
            id: 'inventory-dc-return',
            label: 'DC Return',
            screenId: 'dc-return',
            tabIcon: 'assignment_return',
          },
          {
            type: 'item',
            id: 'inventory-invoice-return',
            label: 'Invoice Return',
            screenId: 'invoice-return',
            tabIcon: 'assignment_return',
          },
          {
            type: 'item',
            id: 'stock-return',
            label: 'Stock Return',
            screenId: 'stock-return',
            tabIcon: 'assignment_return',
          },
        ],
      },

      {
        type: 'group',
        id: 'inventory-allotment',
        label: 'Allotment',
        icon: 'assignment_turned_in',
        children: [
          {
            type: 'heading',
            id: 'inventory-allotment-heading',
            label: 'ALLOTMENT',
            icon: 'assignment_turned_in',
          },
          {
            type: 'item',
            id: 'stock-allotment',
            label: 'Stock Allotment',
            screenId: 'stock-allotment',
            tabIcon: 'assignment_turned_in',
          },
          {
            type: 'item',
            id: 'stock-release',
            label: 'Stock Release',
            screenId: 'stock-release',
            tabIcon: 'assignment_turned_in',
          },
        ],
      },

      {
        type: 'group',
        id: 'inventory-adjustment',
        label: 'Adjustment',
        icon: 'edit_note',
        children: [
          {
            type: 'heading',
            id: 'inventory-adjustment-heading',
            label: 'ADJUSTMENT',
            icon: 'edit_note',
          },
          {
            type: 'item',
            id: 'stock-amendment',
            label: 'Stock Amendment',
            screenId: 'stock-amendment',
            tabIcon: 'edit_note',
          },
          {
            type: 'item',
            id: 'physical-stock-amendment',
            label: 'Physical Stock Amendment',
            screenId: 'physical-stock-amendment',
            tabIcon: 'edit_note',
          },
        ],
      },

      {
        type: 'item',
        id: 'inventory-reports',
        label: 'Inventory Reports',
        icon: 'monitoring',
        screenId: 'reports',
      },
    ],
  },

  {
    id: 'planning',
    label: 'Planning',
    icon: 'event_note',
    children: [
      {
        type: 'item',
        id: 'planning-dashboard',
        label: 'Planning Dashboard',
        icon: 'space_dashboard',
        screenId: 'planning-dashboard',
        tabIcon: 'space_dashboard',
      },
      {
        type: 'item',
        id: 'work-order',
        label: 'Work Order',
        icon: 'assignment',
        screenId: 'work-order',
      },
      {
        type: 'item',
        id: 'production-bom',
        label: 'Production BOM',
        icon: 'account_tree',
        screenId: 'production-bom',
      },
      {
        type: 'item',
        id: 'route-sheet',
        label: 'Route Sheet',
        icon: 'route',
        screenId: 'route-sheet',
      },
      {
        type: 'item',
        id: 'material-planning',
        label: 'Material Planning',
        icon: 'inventory_2',
        screenId: 'material-planning',
      },
      {
        type: 'item',
        id: 'fg-possible',
        label: 'FG Possible',
        icon: 'check_circle',
        screenId: 'fg-possible',
      },
      {
        type: 'item',
        id: 'dispatch-plan',
        label: 'Dispatch Plan',
        icon: 'local_shipping',
        screenId: 'dispatch-plan',
      },
      {
        type: 'item',
        id: 'machine-load',
        label: 'Machine Load Plan',
        icon: 'bar_chart',
        screenId: 'machine-load',
      },
      {
        type: 'item',
        id: 'machine-load-gantt',
        label: 'Machine Load Gantt',
        icon: 'view_timeline',
        screenId: 'machine-load-gantt',
      },
      {
        type: 'item',
        id: 'engineering-change',
        label: 'Request (ECR)',
        icon: 'change_circle',
        screenId: 'engineering-change',
      },
      {
        type: 'item',
        id: 'gap-analysis',
        label: 'Gap Analysis',
        icon: 'analytics',
        screenId: 'gap-analysis',
      },
      {
        type: 'item',
        id: 'cost-estimation',
        label: 'Cost Estimation – Old',
        icon: 'calculate',
        screenId: 'cost-estimation',
      },
    ],
  },

  {
    id: 'production',
    label: 'Production',
    icon: 'precision_manufacturing',
    children: [
      {
        type: 'group',
        id: 'production-planning',
        label: 'Production Planning',
        icon: 'calendar_month',
        children: [
          { type: 'heading', id: 'production-planning-heading', label: 'PRODUCTION PLANNING', icon: 'calendar_month' },
          {
            type: 'item',
            id: 'production-dashboard',
            label: 'Production Dashboard',
            icon: 'space_dashboard',
            screenId: 'production-dashboard',
            tabIcon: 'space_dashboard',
          },
        ],
      },

      {
        type: 'group',
        id: 'production-orders',
        label: 'Production Orders',
        icon: 'fact_check',
        children: [
          { type: 'heading', id: 'production-orders-heading', label: 'PRODUCTION ORDERS', icon: 'fact_check' },
          {
            type: 'item',
            id: 'production-order',
            label: 'Production Order',
            icon: 'assignment_turned_in',
            screenId: 'production-order',
          },
        ],
      },

      {
        type: 'group',
        id: 'shop-floor-execution',
        label: 'Shop Floor Execution',
        icon: 'precision_manufacturing',
        children: [
          { type: 'heading', id: 'shop-floor-execution-heading', label: 'SHOP FLOOR EXECUTION', icon: 'precision_manufacturing' },
          {
            type: 'item',
            id: 'job-card',
            label: 'Job Card',
            icon: 'assignment',
            screenId: 'job-card',
          },
          {
            type: 'item',
            id: 'job-card-kanban',
            label: 'Job Card Kanban',
            icon: 'view_kanban',
            screenId: 'job-card-kanban',
          },
          {
            type: 'item',
            id: 'production-entry',
            label: 'Production Entry',
            icon: 'engineering',
            screenId: 'production-entry',
          },
          {
            type: 'item',
            id: 'production-log',
            label: 'Production Log Sheet',
            icon: 'list_alt',
            screenId: 'production-log',
          },
          {
            type: 'item',
            id: 'shop-floor-entry',
            label: 'Shop Floor Entry',
            icon: 'engineering',
            screenId: 'shop-floor-entry',
          },
        ],
      },

      {
        type: 'group',
        id: 'production-transactions',
        label: 'Production Transactions',
        icon: 'swap_horiz',
        children: [
          { type: 'heading', id: 'production-transactions-heading', label: 'PRODUCTION TRANSACTIONS', icon: 'swap_horiz' },
          {
            type: 'item',
            id: 'product-conversion',
            label: 'Product Conversion',
            icon: 'swap_horiz',
            screenId: 'product-conversion',
          },
          {
            type: 'item',
            id: 'production-return',
            label: 'Production Return',
            icon: 'replay',
            screenId: 'production-return',
          },
          {
            type: 'item',
            id: 'material-request',
            label: 'Material Request',
            icon: 'move_to_inbox',
            screenId: 'material-request',
          },
          {
            type: 'item',
            id: 'consumption',
            label: 'Consumption',
            icon: 'local_fire_department',
            screenId: 'consumption',
          },
          {
            type: 'item',
            id: 'idle-time',
            label: 'Idle Time',
            icon: 'schedule',
            screenId: 'idle-time',
          },
          {
            type: 'item',
            id: 'tool-life',
            label: 'Tool Life / Tool Change',
            icon: 'construction',
            screenId: 'tool-life',
          },
          {
            type: 'item',
            id: 'production-rejections',
            label: 'Rejection Records',
            icon: 'report_problem',
            screenId: 'production-rejections',
          },
          {
            type: 'item',
            id: 'production-scraps',
            label: 'Scrap Records',
            icon: 'delete_sweep',
            screenId: 'production-scraps',
          },
          {
            type: 'item',
            id: 'production-reworks',
            label: 'Rework Records',
            icon: 'construction',
            screenId: 'production-reworks',
          },
          {
            type: 'item',
            id: 'batch-card',
            label: 'Batch Cards',
            icon: 'tag',
            screenId: 'batch-card',
          },
          {
            type: 'item',
            id: 'production-quality-gate',
            label: 'Quality Gate',
            icon: 'gavel',
            screenId: 'production-quality-gate',
          },
        ],
      },

      {
        type: 'group',
        id: 'monitoring-control',
        label: 'Monitoring & Control',
        icon: 'monitoring',
        children: [
          { type: 'heading', id: 'monitoring-control-heading', label: 'MONITORING & CONTROL', icon: 'monitoring' },
          {
            type: 'item',
            id: 'production-pending',
            label: 'Production Pending',
            icon: 'pending_actions',
            screenId: 'production-pending',
          },
        ],
      },

      {
        type: 'group',
        id: 'capacity-performance',
        label: 'Capacity & Performance',
        icon: 'speed',
        children: [
          { type: 'heading', id: 'capacity-performance-heading', label: 'CAPACITY & PERFORMANCE', icon: 'speed' },
          {
            type: 'item',
            id: 'oee',
            label: 'OEE / Manufacturing Performance',
            icon: 'speed',
            screenId: 'oee',
          },
          {
            type: 'item',
            id: 'machine-load',
            label: 'Machine Load Plan',
            icon: 'bar_chart',
            screenId: 'machine-load',
          },
          {
            type: 'item',
            id: 'machine-load-gantt',
            label: 'Machine Load Gantt',
            icon: 'view_timeline',
            screenId: 'machine-load-gantt',
          },
        ],
      },

      {
        type: 'group',
        id: 'production-reports',
        label: 'Production Reports & Analytics',
        icon: 'analytics',
        children: [
          { type: 'heading', id: 'production-reports-heading', label: 'PRODUCTION REPORTS & ANALYTICS', icon: 'analytics' },
          {
            type: 'item',
            id: 'work-order-reports',
            label: 'Work Order Reports',
            icon: 'description',
            screenId: 'work-order-reports',
          },
          {
            type: 'item',
            id: 'production-reports',
            label: 'Production Reports & Analytics',
            icon: 'analytics',
            screenId: 'production-reports',
          },
          {
            type: 'item',
            id: 'production-output',
            label: 'Production Output / WIP',
            icon: 'fact_check',
            screenId: 'production-output',
          },
          {
            type: 'item',
            id: 'production-rejection',
            label: 'Production Rejection / Scrap Summary',
            icon: 'block',
            screenId: 'production-rejection',
          },
        ],
      },
    ],
  },

  {
    id: 'quality',
    label: 'Quality',
    icon: 'verified',
    align: 'right',
    children: [
      {
        type: 'group',
        id: 'quality-inspection',
        label: 'Inspection',
        icon: 'fact_check',
        children: [
          {
            type: 'heading',
            id: 'quality-inspection-heading',
            label: 'INSPECTION',
            icon: 'fact_check',
          },

          {
            type: 'group',
            id: 'quality-inward-inspection',
            label: 'Inward Inspection',
            icon: 'move_to_inbox',
            children: [
              {
                type: 'item',
                id: 'inward-inspection-iqc',
                label: 'Inward Inspection (IQC)',
                icon: 'fact_check',
                screenId: 'inward-inspection-iqc',
              },
              {
                type: 'item',
                id: 'lo-inspection',
                label: 'LO Inspection',
                icon: 'construction',
                screenId: 'lo-inspection',
              },
            ],
          },

          {
            type: 'item',
            id: 'jomin-inspection',
            label: 'JOMIN Inspection',
            icon: 'inventory_2',
            screenId: 'jomin-inspection',
          },

          {
            type: 'group',
            id: 'quality-process-inspection',
            label: 'Process Inspection',
            icon: 'settings',
            children: [
              {
                type: 'item',
                id: 'process-inspection-ipqc',
                label: 'Process Inspection (IPQC)',
                icon: 'analytics',
                screenId: 'process-inspection-ipqc',
              },
              {
                type: 'item',
                id: 'first-inspection',
                label: 'First Inspection (FAI)',
                icon: 'first_page',
                screenId: 'first-inspection',
              },
              {
                type: 'item',
                id: 'line-inspection',
                label: 'Line Inspection',
                icon: 'timeline',
                screenId: 'line-inspection',
              },
              {
                type: 'item',
                id: 'last-off-inspection',
                label: 'Last Off Inspection',
                icon: 'last_page',
                screenId: 'last-off-inspection',
              },
            ],
          },

          {
            type: 'item',
            id: 'final-inspection',
            label: 'Final Inspection',
            icon: 'task_alt',
            screenId: 'final-inspection',
          },
          {
            type: 'item',
            id: 'inspection-pending',
            label: 'Inspection Pending',
            icon: 'pending_actions',
            screenId: 'inspection-pending',
          },
        ],
      },

      {
        type: 'group',
        id: 'quality-test-certificate',
        label: 'Test Certificate',
        icon: 'description',
        children: [
          {
            type: 'heading',
            id: 'quality-test-certificate-heading',
            label: 'TEST CERTIFICATE',
            icon: 'description',
          },
          {
            type: 'item',
            id: 'inward-test-certificate',
            label: 'Inward Test Certificate',
            icon: 'move_to_inbox',
            screenId: 'inward-test-certificate',
          },
          {
            type: 'item',
            id: 'internal-test-certificate',
            label: 'Internal Test Certificate',
            icon: 'domain',
            screenId: 'internal-test-certificate',
          },
          {
            type: 'item',
            id: 'outward-test-certificate',
            label: 'Outward Test Certificate',
            icon: 'outbox',
            screenId: 'outward-test-certificate',
          },
        ],
      },

      {
        type: 'item',
        id: 'concession-entry',
        label: 'Concession Entry',
        icon: 'edit_document',
        screenId: 'concession-entry',
      },

      {
        type: 'item',
        id: 'quality-ncr',
        label: 'Non-Conformance Report',
        icon: 'report',
        screenId: 'quality-ncr',
      },

      {
        type: 'group',
        id: 'quality-problem-solving',
        label: 'Complaint & Problem Solving',
        icon: 'report_problem',
        children: [
          {
            type: 'heading',
            id: 'quality-problem-solving-heading',
            label: 'PROBLEM SOLVING',
            icon: 'report_problem',
          },
          {
            type: 'item',
            id: 'customer-complaint',
            label: 'Customer Complaint',
            icon: 'support_agent',
            screenId: 'customer-complaint',
          },
          {
            type: 'item',
            id: 'capa',
            label: 'CAPA',
            icon: 'published_with_changes',
            screenId: 'capa',
          },
          {
            type: 'item',
            id: 'eight-d-report',
            label: '8D Report',
            icon: 'article',
            screenId: 'eight-d-report',
          },
          {
            type: 'item',
            id: 'traceability',
            label: 'Material Traceability',
            icon: 'account_tree',
            screenId: 'traceability',
          },
          {
            type: 'item',
            id: 'quality-spc',
            label: 'SPC Analytics',
            icon: 'analytics',
            screenId: 'quality-spc',
          },
        ],
      },

      {
        type: 'group',
        id: 'quality-calibration',
        label: 'Calibration',
        icon: 'straighten',
        children: [
          {
            type: 'heading',
            id: 'quality-calibration-heading',
            label: 'CALIBRATION',
            icon: 'straighten',
          },
          {
            type: 'item',
            id: 'calibration',
            label: 'Calibration Instruments',
            icon: 'straighten',
            screenId: 'calibration',
          },
          {
            type: 'item',
            id: 'calibration-record',
            label: 'Calibration Record',
            icon: 'description',
            screenId: 'calibration-record',
          },
        ],
      },
    ],
  },

  {
    id: 'maintenance',
    label: 'Maintenance',
    icon: 'build',
    align: 'right',
    children: [
      {
        type: 'item',
        id: 'maintenance-dashboard',
        label: 'Maintenance Dashboard',
        icon: 'space_dashboard',
        screenId: 'maintenance-dashboard',
      },
      {
        type: 'item',
        id: 'maintenance-masters',
        label: 'Masters',
        icon: 'category',
        screenId: 'maintenance-masters',
      },
      {
        type: 'group',
        id: 'maintenance-breakdown',
        label: 'Breakdown',
        icon: 'report_problem',
        children: [
          {
            type: 'heading',
            id: 'maintenance-breakdown-heading',
            label: 'BREAKDOWN',
            icon: 'report_problem',
          },
          {
            type: 'item',
            id: 'breakdown-intimation',
            label: 'Breakdown Intimation',
            icon: 'warning',
            screenId: 'breakdown-intimation',
          },
          {
            type: 'item',
            id: 'breakdown-rectification',
            label: 'Breakdown Rectification',
            icon: 'build',
            screenId: 'breakdown-rectification',
          },
        ],
      },
      {
        type: 'group',
        id: 'maintenance-pm',
        label: 'Preventive Maintenance',
        icon: 'schedule',
        children: [
          {
            type: 'heading',
            id: 'maintenance-pm-heading',
            label: 'PREVENTIVE MAINTENANCE',
            icon: 'schedule',
          },
          {
            type: 'item',
            id: 'pm-plan',
            label: 'PM Plan',
            icon: 'assignment',
            screenId: 'pm-plan',
          },
          {
            type: 'item',
            id: 'pm-schedule',
            label: 'PM Schedule',
            icon: 'event_note',
            screenId: 'pm-schedule',
          },
          {
            type: 'item',
            id: 'pm-completion',
            label: 'PM Completion',
            icon: 'task_alt',
            screenId: 'pm-completion',
          },
          {
            type: 'item',
            id: 'pm-work-order',
            label: 'PM Work Order',
            icon: 'assignment_turned_in',
            screenId: 'pm-work-order',
          },
        ],
      },
      {
        type: 'group',
        id: 'maintenance-tools',
        label: 'Tools Management',
        icon: 'handyman',
        children: [
          {
            type: 'heading',
            id: 'maintenance-tools-heading',
            label: 'TOOLS MANAGEMENT',
            icon: 'handyman',
          },
          {
            type: 'item',
            id: 'tool-service-intimation',
            label: 'Tool Service Intimation',
            icon: 'report',
            screenId: 'tool-service-intimation',
          },
          {
            type: 'item',
            id: 'tool-service-rectification',
            label: 'Tool Service Rectification',
            icon: 'construction',
            screenId: 'tool-service-rectification',
          },
        ],
      },
      {
        type: 'group',
        id: 'maintenance-calibration',
        label: 'Calibration',
        icon: 'straighten',
        children: [
          {
            type: 'heading',
            id: 'maintenance-calibration-heading',
            label: 'CALIBRATION',
            icon: 'straighten',
          },
          {
            type: 'item',
            id: 'calibration-schedule',
            label: 'Calibration Schedule',
            icon: 'calendar_month',
            screenId: 'calibration-schedule',
          },
          {
            type: 'item',
            id: 'calibration-entry',
            label: 'Calibration Entry',
            icon: 'edit_document',
            screenId: 'calibration-entry',
          },
        ],
      },
      {
        type: 'group',
        id: 'maintenance-utilities',
        label: 'Utilities',
        icon: 'electric_bolt',
        children: [
          {
            type: 'heading',
            id: 'maintenance-utilities-heading',
            label: 'UTILITIES',
            icon: 'electric_bolt',
          },
          {
            type: 'item',
            id: 'power-consumption',
            label: 'Power Consumption',
            icon: 'bolt',
            screenId: 'power-consumption',
          },
          {
            type: 'item',
            id: 'water-consumption',
            label: 'Water Consumption',
            icon: 'water_drop',
            screenId: 'water-consumption',
          },
        ],
      },
      {
        type: 'group',
        id: 'maintenance-analysis',
        label: 'Analysis',
        icon: 'analytics',
        children: [
          {
            type: 'heading',
            id: 'maintenance-analysis-heading',
            label: 'ANALYSIS',
            icon: 'analytics',
          },
          {
            type: 'item',
            id: 'rca',
            label: 'Root Cause Analysis',
            icon: 'account_tree',
            screenId: 'rca',
          },
          {
            type: 'item',
            id: 'maintenance-analysis-view',
            label: 'Downtime / MTBF / MTTR',
            icon: 'monitoring',
            screenId: 'maintenance-analysis-view',
          },
        ],
      },
      {
        type: 'item',
        id: 'maintenance-reports',
        label: 'Reports',
        icon: 'assessment',
        screenId: 'maintenance-reports',
      },
      {
        type: 'item',
        id: 'downtime-cost-report',
        label: 'Downtime & Cost Report',
        icon: 'bar_chart',
        screenId: 'downtime-cost-report',
      },
      {
        type: 'item',
        id: 'spare-request',
        label: 'Spare Request',
        icon: 'inventory_2',
        screenId: 'spare-request',
      },
      {
        type: 'item',
        id: 'maintenance-cost',
        label: 'Maintenance Cost',
        icon: 'payments',
        screenId: 'maintenance-cost',
      },
      {
        type: 'item',
        id: 'notification-log',
        label: 'Notifications',
        icon: 'notifications',
        screenId: 'notification-log',
      },
    ],
  },

  {
    id: 'reports-menu',
    label: 'Reports',
    icon: 'monitoring',
    align: 'right',
    children: [
      // Inventory Reports lives only in the sidebar (Inventory > Inventory Reports,
      // screenId 'reports') — this menu used to repeat it under the same screenId,
      // giving the same screen two identical-looking nav entries.
      {
        type: 'item',
        id: 'work-order-reports',
        label: 'Work Order Reports',
        icon: 'assignment',
        screenId: 'work-order-reports',
      },
    ],
  },
];