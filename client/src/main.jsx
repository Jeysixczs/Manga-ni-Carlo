import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { migrateLegacyReaderProgress } from './utils.js';
import './styles.css';

// Folds any pre-existing `readerPage_*` keys into the single bounded map and
// clears them out. Safe to run on every load; it no-ops once they are gone.
migrateLegacyReaderProgress();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
