import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './app/router';
import { storage } from './app/utils/storage';
import './styles/global.css';
import './styles/index.css';

if (typeof window !== 'undefined') {
  window.westosDebug = {
    clearStorage: () => storage.clearAll(),
    clearWorkData: () => storage.clearNamespace('westos.work'),
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <RouterProvider router={router} />
);
