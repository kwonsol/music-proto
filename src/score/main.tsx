import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ScoreApp from './ScoreApp';
import './score.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ScoreApp />
  </StrictMode>,
);
