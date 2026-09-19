import React from 'react';

/**
 * Legacy Accounts prototype retained as a compatibility entry point.
 * The production application is mounted by src/App.tsx.
 */
export default function App() {
  return (
    <section className="min-h-screen bg-white p-8 text-slate-800">
      <h1 className="text-xl font-bold">Accounts module</h1>
      <p className="mt-2 text-sm text-slate-500">Use the main ERP navigation to open Accounts screens.</p>
    </section>
  );
}
