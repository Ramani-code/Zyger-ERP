import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getScreenComponent } from '../config/screenRegistry';
import { NAV_ITEMS } from '../config/navigation';
import { useAuth } from './AuthContext';

export interface Tab {
  id: string;
  label: string;
  icon: string;
  pin?: boolean;
  component: React.ComponentType<any>;
  props?: any;
  reopen?: boolean;
  stamp?: number;
}

interface TabsContextType {
  tabs: Tab[];
  activeTabId: string | null;
  openTab: (tab: Omit<Tab, 'component'> & { component: React.ComponentType<any> }) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
}

const TabsContext = createContext<TabsContextType | undefined>(undefined);

const STORAGE_KEY = 'zyger-tabs';

/** Read the screen id from the URL hash, e.g. "#/purchase-order" → "purchase-order". */
function readHashScreenId(): string | null {
  const hash = window.location.hash.replace(/^#\//, '').replace(/^#/, '');
  return hash || null;
}

/** Write the screen id to the URL hash without triggering a full navigation. */
function writeHashScreenId(screenId: string | null) {
  if (screenId) {
    window.history.replaceState(null, '', `#/${screenId}`);
  } else {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}
const DASHBOARD_TAB: Tab = {
  id: 'dashboard',
  label: 'Dashboard',
  icon: 'space_dashboard',
  pin: true,
  component: getScreenComponent('dashboard'),
};

function findNavMeta(screenId: string): { label: string; icon: string } | null {
  function walk(nodes: unknown[]): { label: string; icon: string } | null {
    for (const n of nodes as Record<string, unknown>[]) {
      if (n.type === 'item' && n.screenId === screenId) {
        return { label: String(n.label), icon: String(n.icon ?? 'article') };
      }
      if (Array.isArray(n.children)) {
        const found = walk(n.children);
        if (found) return found;
      }
    }
    return null;
  }
  return walk(NAV_ITEMS);
}

function loadSavedState(): { tabIds: string[]; activeTabId: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.tabIds) && typeof parsed.activeTabId === 'string') {
      return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

function saveState(tabIds: string[], activeTabId: string | null) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabIds, activeTabId }));
  } catch { /* ignore */ }
}

/** A detail tab opened via openTab carries a suffixed id (e.g. `quality-inspection-29`
 * from Inspection Pending, or `quality-inspection-edit-12`/`-view-12` from a reports
 * drilldown). Those ids are never registered screenIds, so restoring them by
 * getScreenComponent(id) alone landed on the ModulePlaceholder stub. Parse them back
 * to the base screen + props so restored tabs render the real component again. */
function parseDetailTabId(id: string): { base: string; docId: string; viewOnly: boolean } | null {
  const editView = /^(.*)-(edit|view)-(\d+)$/.exec(id);
  if (editView) return { base: editView[1], docId: editView[3], viewOnly: editView[2] === 'view' };
  const numbered = /^(.*)-(\d+)$/.exec(id);
  if (numbered) return { base: numbered[1], docId: numbered[2], viewOnly: false };
  return null;
}

function buildTabsFromIds(ids: string[]): Tab[] {
  const tabs: Tab[] = [];
  for (const id of ids) {
    if (id === 'dashboard') {
      tabs.push(DASHBOARD_TAB);
      continue;
    }
    const component = getScreenComponent(id);
    const meta = findNavMeta(id);
    const detail = detailTabFromId(id);
    tabs.push({
      id,
      label: detail ? detail.label : (meta?.label ?? id),
      icon: detail?.icon ?? meta?.icon ?? 'article',
      component: detail ? detail.component : component,
      props: detail?.props,
    });
  }
  return tabs;
}

function detailTabFromId(id: string): Tab | null {
  const parsed = parseDetailTabId(id);
  if (!parsed) return null;
  const meta = findNavMeta(parsed.base);
  return {
    id,
    label: `${meta?.label ?? parsed.base.replace(/-/g, ' ')} #${parsed.docId}`,
    icon: meta?.icon ?? 'article',
    component: getScreenComponent(parsed.base),
    props: { initialDocId: parsed.docId, viewOnly: parsed.viewOnly },
  };
}

export function TabsProvider({ children }: { children: ReactNode }) {
  const { screensLoaded, canScreen } = useAuth();
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const hashScreen = readHashScreenId();
    const saved = loadSavedState();
    let initialIds: string[] = saved?.tabIds && saved.tabIds.length > 0 ? [...saved.tabIds] : ['dashboard'];
    if (!initialIds.includes('dashboard')) {
      initialIds.unshift('dashboard');
    }
    if (hashScreen && hashScreen !== 'dashboard' && !initialIds.includes(hashScreen)) {
      initialIds.push(hashScreen);
    }
    return buildTabsFromIds(initialIds);
  });

  const [activeTabId, setActiveTabId] = useState<string | null>(() => {
    const hashScreen = readHashScreenId();
    if (hashScreen) return hashScreen;
    const saved = loadSavedState();
    if (saved && saved.tabIds.includes(saved.activeTabId)) {
      return saved.activeTabId;
    }
    return 'dashboard';
  });

  const isInitialMount = useRef(true);

  // Once the user's screen matrix is loaded, drop restored tabs the user can no longer view.
  useEffect(() => {
    if (!screensLoaded) return;
    setTabs(prev => {
      const next = prev.filter(t => {
        if (t.id === 'dashboard') return true;
        const baseId = parseDetailTabId(t.id)?.base ?? t.id;
        return canScreen(baseId, 'View');
      });
      setActiveTabId(active => (active === null || next.some(t => t.id === active) ? active : (next.length > 0 ? next[next.length - 1].id : null)));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screensLoaded]);

  // Sync active tab to URL hash and localStorage
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    saveState(tabs.map(t => t.id), activeTabId);
    writeHashScreenId(activeTabId);
  }, [tabs, activeTabId]);

  // Listen for browser back/forward (hashchange) to sync tabs
  useEffect(() => {
    const onHashChange = () => {
      const hashScreen = readHashScreenId();
      if (hashScreen && hashScreen !== activeTabId) {
        // If the tab exists, just switch to it; otherwise open it
        const exists = tabs.some(t => t.id === hashScreen);
        if (exists) {
          setActiveTabId(hashScreen);
        } else {
          const meta = findNavMeta(hashScreen);
          const detail = detailTabFromId(hashScreen);
          openTab({
            id: hashScreen,
            label: detail ? detail.label : (meta?.label ?? hashScreen),
            icon: detail?.icon ?? meta?.icon ?? 'article',
            component: detail ? detail.component : getScreenComponent(hashScreen),
            props: detail?.props,
          });
        }
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, activeTabId]);

  const openTab = useCallback((newTab: Tab) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === newTab.id);
      if (idx === -1) return [...prev, newTab];
      if (newTab.reopen) {
        const copy = [...prev];
        copy[idx] = { ...newTab, stamp: (prev[idx].stamp ?? 0) + 1 };
        return copy;
      }
      return prev;
    });
    setActiveTabId(newTab.id);
  }, []);

  const closeTab = useCallback((id: string) => {
    // Callers (e.g. a "View" tab's onBack) capture this closure once, at the
    // moment the tab is opened — by the time Back is actually clicked, the
    // active tab has since changed to that view tab, so a stale outer
    // `activeTabId` would no longer match and the active tab would never get
    // reassigned away from the just-removed tab (leaving nothing rendered,
    // since no tab in the array matches the stale activeTabId anymore).
    // Functional updates read live state instead, so this stays correct
    // regardless of when the closure was created.
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      setActiveTabId(prevActive =>
        prevActive === id ? (next.length > 0 ? next[next.length - 1].id : null) : prevActive
      );
      return next;
    });
  }, []);

  const setActiveTab = useCallback((id: string) => {
    setActiveTabId(id);
  }, []);

  return (
    <TabsContext.Provider value={{ tabs, activeTabId, openTab, closeTab, setActiveTab }}>
      {children}
    </TabsContext.Provider>
  );
}

export const useTabs = () => {
  const context = useContext(TabsContext);
  if (!context) {
    return {
      tabs: [],
      activeTabId: null,
      openTab: () => {},
      closeTab: () => {},
      setActiveTab: () => {},
    };
  }
  return context;
};
