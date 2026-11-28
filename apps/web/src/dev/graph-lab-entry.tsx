/// <reference types="vite/client" />
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { GraphLab } from './graph-lab';

if (import.meta.env.DEV) {
  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <BrowserRouter>
        <GraphLab />
      </BrowserRouter>
    </StrictMode>,
  );
  import.meta.hot?.dispose(() => root.unmount());
}
