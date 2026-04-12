import { Navigate, createBrowserRouter } from 'react-router-dom';
import { LandingPage } from '../features/landing/LandingPage';
import { ReadmePage } from '../features/readme/ReadmePage';
import { AISettingsPage } from '../features/settings/AISettingsPage';
import { DocumentsPage } from '../features/ai/DocumentsPage';
import { DocumentDetailPage } from '../features/ai/DocumentDetailPage';
import { TablePage } from '../features/tables/TablePage';
import { DocumentPage } from '../features/uploads/DocumentPage';
import { ProcessedKBPage } from '../features/kb/ProcessedKBPage';
import { WorkPage } from '../features/work/WorkPage';
import { GetUserGroupsPage } from '../features/work/GetUserGroupsPage';
import { GroupSearchToolPage } from '../features/work/GroupSearchToolPage';
import { TicketDetail } from '../features/work/pages/TicketDetail';
import { WorkInsightsPage } from '../features/work/WorkInsightsPage';
import { UserGroupAssociationPage } from '../features/work/UserGroupAssociationPage';
import { ConsoleEndpointsPage } from '../features/console/ConsoleEndpointsPage';
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

export const router = createBrowserRouter(
  [
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
        path: 'console/endpoints',
        Component: ConsoleEndpointsPage
      },
      {
        path: 'settings',
        lazy: getRoute('../features/settings/routes.jsx')
      },
      {
        path: 'data',
        lazy: getRoute('../features/data/routes.jsx')
      },
      {
        path: 'reference',
        lazy: getRoute('../features/reference/routes.jsx')
      },
      {
        path: 'ai',
        Component: AISettingsPage
      },
      {
        path: 'ai/documents',
        Component: DocumentsPage
      },
      {
        path: 'ai/documents/:id',
        Component: DocumentDetailPage
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
        path: 'kb',
        lazy: getRoute('../features/kb/routes.jsx')
      },
      {
        path: 'kb/processed',
        Component: ProcessedKBPage
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
        path: 'document',
        Component: DocumentPage
      },
      {
        path: 'work/ai-metrics',
        Component: WorkInsightsPage
      },
      {
        path: 'work/group-search',
        Component: GroupSearchToolPage
      },
      {
        path: 'work/get-user-groups',
        Component: GetUserGroupsPage
      },
      {
        path: 'work/user-group-association',
        Component: UserGroupAssociationPage
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
    path: '/document',
    element: <Navigate replace to="/app/document" />
  },
  {
    path: '/work/group-search',
    element: <Navigate replace to="/app/work/group-search" />
  },
  {
    path: '/work/get-user-groups',
    element: <Navigate replace to="/app/work/get-user-groups" />
  },
  {
    path: '/work/user-group-association',
    element: <Navigate replace to="/app/work/user-group-association" />
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
    path: '/ai/documents',
    element: <Navigate replace to="/app/ai/documents" />
  },
  {
    path: '/admin',
    element: <Navigate replace to="/app/console" />
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
    path: '/kb/processed',
    element: <Navigate replace to="/app/kb/processed" />
  },
  {
    path: '/data',
    element: <Navigate replace to="/app/data" />
  },
  {
    path: '/reference',
    element: <Navigate replace to="/app/reference" />
  },
  {
    path: '*',
    element: <Navigate replace to="/" />
    }
  ],
  {
    future: {
      v7_startTransition: true,
    },
  }
);
