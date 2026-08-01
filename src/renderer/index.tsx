import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { lightningshareAPI } from './api';
import './styles/index.css';

(window as any).lightningshare = lightningshareAPI;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
