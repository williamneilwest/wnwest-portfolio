import { Navigate, createBrowserRouter } from 'react-router-dom';
import { LandingPage } from '../features/landing/LandingPage';
import { AppShell } from './shell/AppShell';

const routeModules = import.meta.glob('../features/*/routes.jsx');

export const router = createBrowserRouter([
  {
    path: '/',
    Component: LandingPage
  },
  {
    path: '/app',
    Component: AppShell,
    children: [
      {
        index: true,
        element: <Navigate replace to="/app/life" />
      },
      {
        path: 'life',
        lazy: routeModules['../features/life/routes.jsx']
      },
      {
        path: 'console',
        lazy: routeModules['../features/console/routes.jsx']
      },
      {
        path: 'work',
        element: <Navigate replace to="/csv" />
      }
    ]
  },
  {
    path: '/csv',
    Component: AppShell,
    children: [
      {
        index: true,
        lazy: routeModules['../features/work/routes.jsx']
      }
    ]
  },
  {
    path: '/ai',
    Component: AppShell,
    children: [
      {
        index: true,
        lazy: routeModules['../features/ai/routes.jsx']
      }
    ]
  },
  {
    path: '/life',
    element: <Navigate replace to="/app/life" />
  },
  {
    path: '/work',
    element: <Navigate replace to="/csv" />
  },
  {
    path: '/console',
    element: <Navigate replace to="/app/console" />
  },
  {
    path: '*',
    element: <Navigate replace to="/" />
  }
]);
