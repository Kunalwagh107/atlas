import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import './styles/tokens.css';
import './styles/global.css';
import './styles/layout.css';
import './styles/sidebar.css';
import './styles/canvas.css';
import './styles/dialogs.css';
import './styles/refresh.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root is missing from index.html');
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
