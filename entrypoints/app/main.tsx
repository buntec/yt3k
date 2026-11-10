import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import './style.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { startDriveSync } from './sync/drive';

startDriveSync();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
