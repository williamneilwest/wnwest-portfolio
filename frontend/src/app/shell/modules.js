import { Blocks, BrainCircuit, Cog, Database, HeartPulse, BookText, Network, UserCircle2 } from 'lucide-react';

export const modules = [
  { href: '/app/life', label: 'Life', summary: 'Personal systems', icon: HeartPulse, readmeHref: '/readme#life' },
  { href: '/app/work', label: 'Work', summary: 'Operational file tools', icon: Blocks, readmeHref: '/readme#work' },
  { href: '/app/data', label: 'Data Hub', summary: 'Modular data tools', icon: Database, readmeHref: '/readme' },
  { href: '/app/kb', label: 'Knowledge Base', summary: 'Documents and references', icon: BookText, readmeHref: '/readme' },
  { href: '/app/profile', label: 'Profile', summary: 'Personal defaults and links', icon: UserCircle2, readmeHref: '/readme' },
  { href: '/app/flows', label: 'Flows', summary: 'Execution tracking', icon: Network, readmeHref: '/readme' },
  { href: '/app/ai', label: 'AI', summary: 'Models and workspace', icon: BrainCircuit, readmeHref: '/readme#ai' },
  { href: '/app/system', label: 'System Viewer', summary: 'Feature and service map', icon: Network, readmeHref: '/readme#console' },
  { href: '/app/settings', label: 'Settings', summary: 'App configuration', icon: Cog, readmeHref: '/readme' }
];
