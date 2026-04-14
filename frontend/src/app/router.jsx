import { Navigate, createBrowserRouter } from 'react-router-dom';
import { ReadmePage } from '../features/readme/ReadmePage';
import { AISettingsPage } from '../features/settings/AISettingsPage';
import { DocumentsPage } from '../features/ai/DocumentsPage';
import { DocumentDetailPage } from '../features/ai/DocumentDetailPage';
import { TablePage } from '../features/tables/TablePage';
import { DocumentPage } from '../features/uploads/DocumentPage';
import { ProcessedKBPage } from '../features/kb/ProcessedKBPage';
import { WorkPage } from '../features/work/WorkPage';
import { TicketDetail } from '../features/work/pages/TicketDetail';
import { WorkInsightsPage } from '../features/work/WorkInsightsPage';
import { WorkHubPage } from '../features/work/WorkHubPage';
import { WorkDomainPage } from '../features/work/WorkDomainPage';
import { SoftwareRegistryPage } from '../features/software/SoftwareRegistryPage';
import { SystemViewerPage } from '../features/system/SystemViewerPage';
import { FlowRunsPage } from '../features/system/FlowRunsPage';
import { FlowTemplatesPage } from '../features/system/FlowTemplatesPage';
import { LoginPage } from '../features/auth/LoginPage';
import { AdminUsersPage } from '../features/auth/AdminUsersPage';
import { ProfilePage } from '../features/auth/ProfilePage';
import { LandingPage } from '../features/landing/LandingPage';
import { TerminalPage } from '../features/admin/TerminalPage';
import { AdminFlowsPage } from '../features/admin/AdminFlowsPage';
import { FlowBuilderPage } from '../features/admin/FlowBuilderPage';
import { AppDesignerPage } from '../features/dev/AppDesignerPage';
import { DataSourcesPage } from '../features/data/DataSourcesPage';
import { AppShell } from './shell/AppShell';
import { isWorkDomainHost } from './constants/domain';
import { RequireAuth } from './router/RequireAuth';
import { RequireAdmin } from './router/RequireAdmin';

const routeModules = import.meta.glob('../features/*/routes.jsx');
const missingRoute = async () => ({ Component: () => null });
const hostname = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : '';
const subdomainRouteMap = {
  work: '/app/work',
  data: '/app/data',
  ai: '/app/ai',
  life: '/app/life',
};
const hostnamePrefix = hostname.split('.')[0] || '';
const defaultAppRoute = subdomainRouteMap[hostnamePrefix] || '/app/life';
const isWorkSubdomain = isWorkDomainHost(hostname);
const workRedirect = <Navigate replace to="/app/work" />;

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
      path: '/app/work',
      element: <AppShell />,
      children: [
        {
          index: true,
          Component: WorkHubPage
        },
        {
          path: 'active-tickets',
          element: <WorkPage readOnly />
        }
      ]
    },
    {
    path: '/',
    element: isWorkSubdomain ? <Navigate replace to="/app/work" /> : <LandingPage />
  },
    {
      path: '/login',
      element: isWorkSubdomain ? workRedirect : <LoginPage />
    },
    {
    path: '/app',
    element: isWorkSubdomain ? <AppShell /> : <RequireAuth><AppShell /></RequireAuth>,
    children: [
      {
        index: true,
        element: <Navigate replace to={defaultAppRoute} />
      },
      {
        path: 'life',
        ...(isWorkSubdomain
          ? { element: workRedirect }
          : { lazy: getRoute('../features/life/routes.jsx') })
      },
      {
        path: 'console',
        element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/system" />
      },
      {
        path: 'system',
        element: isWorkSubdomain ? workRedirect : <RequireAdmin><SystemViewerPage /></RequireAdmin>
      },
      {
        path: 'flows',
        element: isWorkSubdomain ? workRedirect : <RequireAuth><FlowRunsPage /></RequireAuth>
      },
      {
        path: 'flows/templates',
        element: isWorkSubdomain ? workRedirect : <RequireAuth><FlowTemplatesPage /></RequireAuth>
      },
      {
        path: 'terminal',
        element: isWorkSubdomain ? workRedirect : <RequireAdmin><TerminalPage /></RequireAdmin>
      },
      {
        path: 'console/endpoints',
        element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/system" />
      },
      {
        path: 'settings',
        ...(isWorkSubdomain
          ? { element: workRedirect }
          : { lazy: getRoute('../features/settings/routes.jsx') })
      },
      {
        path: 'data',
        ...(isWorkSubdomain
          ? { element: workRedirect }
          : { lazy: getRoute('../features/data/routes.jsx') })
      },
      {
        path: 'data-sources',
        ...(isWorkSubdomain
          ? { element: workRedirect }
          : { Component: DataSourcesPage })
      },
      {
        path: 'data/active-tickets',
        Component: TablePage
      },
      {
        path: 'reference',
        ...(isWorkSubdomain
          ? { element: workRedirect }
          : { lazy: getRoute('../features/reference/routes.jsx') })
      },
      {
        path: 'ai',
        element: isWorkSubdomain ? workRedirect : <AISettingsPage />
      },
      {
        path: 'ai/documents',
        element: isWorkSubdomain ? workRedirect : <DocumentsPage />
      },
      {
        path: 'ai/documents/:id',
        element: isWorkSubdomain ? workRedirect : <DocumentDetailPage />
      },
      {
        path: 'settings/ai',
        element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/ai" />
      },
      {
        path: 'admin/users',
        element: isWorkSubdomain ? workRedirect : <RequireAdmin><AdminUsersPage /></RequireAdmin>
      },
      {
        path: 'admin/flows',
        element: isWorkSubdomain ? workRedirect : <RequireAdmin><AdminFlowsPage /></RequireAdmin>
      },
      {
        path: 'admin/flow-builder',
        element: isWorkSubdomain ? workRedirect : <RequireAdmin><FlowBuilderPage /></RequireAdmin>
      },
      {
        path: 'dev/designer',
        element: isWorkSubdomain ? workRedirect : <RequireAdmin><AppDesignerPage /></RequireAdmin>
      },
      {
        path: 'profile',
        element: isWorkSubdomain ? workRedirect : <ProfilePage />
      },
      {
        path: 'uploads',
        lazy: getRoute('../features/uploads/routes.jsx')
      },
      {
        path: 'kb',
        ...(isWorkSubdomain
          ? { element: workRedirect }
          : { lazy: getRoute('../features/kb/routes.jsx') })
      },
      {
        path: 'kb/processed',
        element: isWorkSubdomain ? workRedirect : <ProcessedKBPage />
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
        path: 'work/tickets',
        element: <Navigate replace to="/app/work/active-tickets" />
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
        element: <Navigate replace to="/app/work/groups" />
      },
      {
        path: 'work/get-user-groups',
        element: <Navigate replace to="/app/work/users" />
      },
      {
        path: 'work/user-group-association',
        element: <Navigate replace to="/app/work/users" />
      },
      {
        path: 'software',
        Component: SoftwareRegistryPage
      },
      {
        path: 'work/users',
        element: <WorkDomainPage domain="users" />
      },
      {
        path: 'work/devices',
        element: <WorkDomainPage domain="devices" />
      },
      {
        path: 'work/printers',
        element: <WorkDomainPage domain="printers" />
      },
      {
        path: 'work/groups',
        element: <WorkDomainPage domain="groups" />
      },
      {
        path: 'work/software',
        element: <WorkDomainPage domain="software" />
      },
      {
        path: 'work/hardware',
        element: <WorkDomainPage domain="hardware" />
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
    path: '/work/tickets',
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
    element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/document" />
  },
  {
    path: '/work/group-search',
    element: <Navigate replace to="/app/work/groups" />
  },
  {
    path: '/work/get-user-groups',
    element: <Navigate replace to="/app/work/users" />
  },
  {
    path: '/work/user-group-association',
    element: <Navigate replace to="/app/work/users" />
  },
  {
    path: '/work/insights',
    element: <Navigate replace to="/app/work/ai-metrics" />
  },
  {
    path: '/work/users',
    element: <Navigate replace to="/app/work/users" />
  },
  {
    path: '/work/devices',
    element: <Navigate replace to="/app/work/devices" />
  },
  {
    path: '/work/printers',
    element: <Navigate replace to="/app/work/printers" />
  },
  {
    path: '/work/groups',
    element: <Navigate replace to="/app/work/groups" />
  },
  {
    path: '/work/software',
    element: <Navigate replace to="/app/work/software" />
  },
  {
    path: '/work/hardware',
    element: <Navigate replace to="/app/work/hardware" />
  },
  {
    path: '/readme',
    element: isWorkSubdomain ? <AppShell /> : <RequireAuth><AppShell /></RequireAuth>,
    children: [
      isWorkSubdomain
        ? {
            index: true,
            element: workRedirect
          }
        : {
            index: true,
            Component: ReadmePage
          }
    ]
  },
  {
    path: '/tickets',
    element: <AppShell />,
    children: [
      {
        path: ':ticketId',
        Component: TicketDetail
      }
    ]
  },
  {
    path: '/csv',
    element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/data" />
  },
  {
    path: '/life',
    element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/life" />
  },
  {
    path: '/console',
    element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/console" />
  },
  {
    path: '/system',
    element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/system" />
  },
  {
    path: '/flows',
    element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/flows" />
  },
  {
    path: '/terminal',
    element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/terminal" />
  },
  {
    path: '/ai',
    element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/ai" />
  },
  {
    path: '/ai/documents',
    element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/ai/documents" />
  },
  {
    path: '/admin',
    element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/console" />
  },
  {
    path: '/admin/users',
    element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/admin/users" />
  },
  {
    path: '/admin/flows',
    element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/admin/flows" />
  },
  {
    path: '/profile',
    element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/profile" />
  },
  {
    path: '/settings',
    element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/settings" />
  },
  {
    path: '/settings/ai',
    element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/ai" />
  },
  {
    path: '/uploads',
    element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/uploads" />
  },
  {
    path: '/kb/processed',
    element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/kb/processed" />
  },
  {
    path: '/data',
    element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/data" />
  },
  {
    path: '/reference',
    element: isWorkSubdomain ? workRedirect : <Navigate replace to="/app/reference" />
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
