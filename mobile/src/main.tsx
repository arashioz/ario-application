import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// SW قدیمی روی گواهی نامعتبر را پاک کن تا رفرش قطع نشود
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((regs) => {
    for (const r of regs) void r.unregister();
  });
}

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);