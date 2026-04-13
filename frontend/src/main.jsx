import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './app/router';
import { storage } from './app/utils/storage';
import { AuthProvider } from './features/auth/AuthContext';
import './styles/global.css';
import './styles/index.css';

if (typeof window !== 'undefined') {
  const MOBILE_BREAKPOINT = 768;
  const applyViewportClass = () => {
    const isMobile = window.innerWidth < MOBILE_BREAKPOINT;
    document.documentElement.classList.toggle('is-mobile', isMobile);
    document.documentElement.classList.toggle('is-desktop', !isMobile);
    document.body.classList.toggle('is-mobile', isMobile);
    document.body.classList.toggle('is-desktop', !isMobile);
  };

  applyViewportClass();
  window.addEventListener('resize', applyViewportClass, { passive: true });

  window.westosDebug = {
    clearStorage: () => storage.clearAll(),
    clearWorkData: () => storage.clearNamespace('westos.work'),
  };
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <RouterProvider router={router} />
  </AuthProvider>
);
