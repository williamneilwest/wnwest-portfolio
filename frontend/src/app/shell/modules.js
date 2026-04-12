import { Blocks, BrainCircuit, Cog, Database, HeartPulse, ShieldEllipsis, TerminalSquare, BookText } from 'lucide-react';

export const modules = [
  { href: '/app/life', label: 'Life', summary: 'Personal systems', icon: HeartPulse, readmeHref: '/readme#life' },
  { href: '/app/work', label: 'work', summary: 'Operational file tools', icon: Blocks, readmeHref: '/readme#work' },
  { href: '/app/data', label: 'Data', summary: 'Uploads and tables', icon: Database, readmeHref: '/readme' },
  { href: '/app/kb', label: 'Knowledge Base', summary: 'Documents and references', icon: BookText, readmeHref: '/readme' },
  { href: '/app/admin', label: 'Admin', summary: 'Admin tools', icon: ShieldEllipsis, readmeHref: '/readme' },
  { href: '/app/ai', label: 'AI', summary: 'Models and workspace', icon: BrainCircuit, readmeHref: '/readme#ai' },
  { href: '/app/settings', label: 'Settings', summary: 'App configuration', icon: Cog, readmeHref: '/readme' },
  { href: '/app/console', label: 'Console', summary: 'Service status', icon: TerminalSquare, readmeHref: '/readme#console' }
];
