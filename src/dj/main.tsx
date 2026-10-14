import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import DjApp from './DjApp';
import './dj.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DjApp />
  </StrictMode>,
);
