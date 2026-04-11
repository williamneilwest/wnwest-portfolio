import { Navigate, createBrowserRouter } from 'react-router-dom';
import { LandingPage } from '../features/landing/LandingPage';
import { ReadmePage } from '../features/readme/ReadmePage';
import { AISettingsPage } from '../features/settings/AISettingsPage';
import { TablePage } from '../features/tables/TablePage';
import { WorkPage } from '../features/work/WorkPage';
import { TicketDetail } from '../features/work/pages/TicketDetail';
import { WorkInsightsPage } from '../features/work/WorkInsightsPage';
import { AppShell } from './shell/AppShell';

const routeModules = import.meta.glob('../features/*/routes.jsx');
const missingRoute = async () => ({ Component: () => null });

const getRoute = (path) => {
  if (!routeModules[path]) {
    console.error(`Missing route module: ${path}`);
    return missingRoute;
  }

  return async () => {
    const module = await routeModules[path]();
    if (typeof module.default !== 'function') {
      console.error(`Invalid route module: ${path}`);
      return { Component: () => null };
    }

    return module.default();
  };
};

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
        lazy: getRoute('../features/life/routes.jsx')
      },
      {
        path: 'console',
        lazy: getRoute('../features/console/routes.jsx')
      },
      {
        path: 'settings',
        lazy: getRoute('../features/settings/routes.jsx')
      },
      {
        path: 'ai',
        Component: AISettingsPage
      },
      {
        path: 'settings/ai',
        element: <Navigate replace to="/app/ai" />
      },
      {
        path: 'uploads',
        lazy: getRoute('../features/uploads/routes.jsx')
      },
      {
        path: 'work',
        lazy: getRoute('../features/work/routes.jsx')
      },
      {
        path: 'work/active-tickets',
        Component: WorkPage
      },
      {
        path: 'work/table',
        Component: TablePage
      },
      {
        path: 'work/ai-metrics',
        Component: WorkInsightsPage
      },
      {
        path: 'work/insights',
        element: <Navigate replace to="/app/work/ai-metrics" />
      }
    ]
  },
  {
    path: '/work',
    element: <Navigate replace to="/app/work" />
  },
  {
    path: '/work/active-tickets',
    element: <Navigate replace to="/app/work/active-tickets" />
  },
  {
    path: '/work/ai-metrics',
    element: <Navigate replace to="/app/work/ai-metrics" />
  },
  {
    path: '/work/table',
    element: <Navigate replace to="/app/work/table" />
  },
  {
    path: '/work/insights',
    element: <Navigate replace to="/app/work/ai-metrics" />
  },
  {
    path: '/readme',
    Component: AppShell,
    children: [
      {
        index: true,
        Component: ReadmePage
      }
    ]
  },
  {
    path: '/tickets',
    Component: AppShell,
    children: [
      {
        path: ':ticketId',
        Component: TicketDetail
      }
    ]
  },
  {
    path: '/csv',
    element: <Navigate replace to="/app/work/table" />
  },
  {
    path: '/life',
    element: <Navigate replace to="/app/life" />
  },
  {
    path: '/console',
    element: <Navigate replace to="/app/console" />
  },
  {
    path: '/ai',
    element: <Navigate replace to="/app/ai" />
  },
  {
    path: '/settings',
    element: <Navigate replace to="/app/settings" />
  },
  {
    path: '/settings/ai',
    element: <Navigate replace to="/app/ai" />
  },
  {
    path: '/uploads',
    element: <Navigate replace to="/app/uploads" />
  },
  {
    path: '*',
    element: <Navigate replace to="/" />
  }
]);
