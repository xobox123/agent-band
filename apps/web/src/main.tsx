import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/manrope';
import { App } from './App.tsx';
import './theme/theme.css';
import './theme/layout.css';
import './theme/components.css';
import './theme/board.css';
import './theme/screens.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
