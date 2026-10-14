import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import LyricApp from './LyricApp';
import './lyric.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LyricApp />
  </StrictMode>,
);
