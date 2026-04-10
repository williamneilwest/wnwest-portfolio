import { Navigate, createBrowserRouter } from 'react-router-dom';
import { LandingPage } from '../features/landing/LandingPage';
import { TicketDetail } from '../features/work/pages/TicketDetail';
import { WorkInsightsPage } from '../features/work/WorkInsightsPage';
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
        element: <Navigate replace to="/work" />
      }
    ]
  },
  {
    path: '/work',
    Component: AppShell,
    children: [
      {
        index: true,
        lazy: routeModules['../features/work/routes.jsx']
      },
      {
        path: 'insights',
        Component: WorkInsightsPage
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
    element: <Navigate replace to="/work" />
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
    path: '*',
    element: <Navigate replace to="/" />
  }
]);
