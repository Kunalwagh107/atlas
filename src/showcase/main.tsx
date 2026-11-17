import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/tokens.css';
import './showcase.css';
import { registerServiceWorker } from '../pwa/registerServiceWorker';
import { ShowcasePage } from './ShowcasePage';

registerServiceWorker(() => undefined);

const root = document.getElementById('showcase-root');
if (!root) throw new Error('Showcase root is missing');

createRoot(root).render(
  <StrictMode>
    <ShowcasePage />
  </StrictMode>,
);
