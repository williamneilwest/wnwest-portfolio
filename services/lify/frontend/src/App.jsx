import { useEffect, useState } from 'react'
import { BrowserRouter as Router, Link, Route, Routes } from 'react-router-dom'

const pillars = [
  {
    eyebrow: 'Operate',
    title: 'One surface for the full stack',
    body:
      'Proxy, AI, media, automation, storage, and internal apps are organized as one system instead of a pile of unrelated containers.',
  },
  {
    eyebrow: 'Scale',
    title: 'Service-first by design',
    body:
      'Each service owns its own compose file, docs, and deployment boundary so the platform can grow without turning brittle.',
  },
  {
    eyebrow: 'Persist',
    title: 'Durable data paths',
    body:
      'State lives in predictable locations, which keeps rebuilds safer and migrations more deliberate.',
  },
]

const products = [
  {
    name: 'Infrastructure Core',
    description: 'Caddy, Portainer, code-server, and Jupyter provide the control layer that keeps the platform maintainable.',
    accent: 'from-cyan-400/30 via-sky-300/10 to-transparent',
    href: '/stack',
  },
  {
    name: 'AI Layer',
    description: 'OpenWebUI, ai-gateway, and custom services like kitchen-ai make model access part of the system, not a side integration.',
    accent: 'from-emerald-400/30 via-teal-300/10 to-transparent',
    href: 'https://chat.wnwest.com',
  },
  {
    name: 'Home Systems',
    description: 'Grocy, Mealie, barcode flows, and future Home Assistant integrations connect the stack to real daily workflows.',
    accent: 'from-amber-300/25 via-orange-200/10 to-transparent',
    href: 'https://pantry.wnwest.com',
  },
  {
    name: 'Media and Downloads',
    description: 'Plex, torrents, filebrowser, and Minecraft run as first-class services instead of disconnected experiments.',
    accent: 'from-fuchsia-400/25 via-pink-300/10 to-transparent',
    href: 'https://files.wnwest.com',
  },
]

const highlights = [
  {
    label: 'Public front door',
    title: 'A clean landing surface',
    body: 'The main domain introduces the platform, explains the ecosystem, and points visitors to the right services without turning into a cluttered dashboard.',
  },
  {
    label: 'AI and tools',
    title: 'Useful internal products',
    body: 'The stack includes a model gateway, browser chat UI, notebook workspace, and custom automation services built for actual use.',
  },
  {
    label: 'Household workflows',
    title: 'Software tied to real life',
    body: 'Inventory, recipes, barcode intake, and future home automation services are part of the same system architecture.',
  },
  {
    label: 'Work tools',
    title: 'Operational data helpers',
    body: 'The platform can also host lightweight utilities for day-to-day work, like CSV analysis, filtering, and quick metrics.',
  },
]

const metrics = [
  { value: '19', label: 'service directories' },
  { value: '10', label: 'durable data paths' },
  { value: '1', label: 'unified platform repo' },
  { value: '24/7', label: 'self-hosted mindset' },
]

const featuredLinks = [
  { label: 'Main site', href: 'https://wnwest.com' },
  { label: 'AI chat', href: 'https://chat.wnwest.com' },
  { label: 'Pantry', href: 'https://pantry.wnwest.com' },
  { label: 'Recipes', href: 'https://recipes.wnwest.com' },
  { label: 'Work tools', href: '/work' },
]

const serviceDirectory = [
  {
    id: 'lify',
    name: 'lify',
    status: 'public',
    summary: 'Main app stack and public landing page.',
    details: 'Serves wnwest.com and www.wnwest.com through the lify-frontend container, with API traffic available separately.',
    role: 'main app surface',
    uiUrl: 'https://wnwest.com',
    extraUrl: 'https://www.wnwest.com',
    apiUrl: 'https://api.wnwest.com',
    docsUrl: '/services/lify/README.md',
  },
  {
    id: 'caddy',
    name: 'caddy',
    status: 'infra',
    summary: 'Reverse proxy and TLS edge for the platform.',
    details: 'Handles browser-facing traffic and routes requests to the right service.',
    role: 'edge routing',
    docsUrl: '/services/caddy/README.md',
  },
  {
    id: 'ai-gateway',
    name: 'ai-gateway',
    status: 'active',
    summary: 'Internal OpenAI-style gateway.',
    details: 'Provides model API access for internal apps and services.',
    role: 'model gateway',
    uiUrl: 'https://ai.wnwest.com',
    docsUrl: '/services/ai-gateway/README.md',
  },
  {
    id: 'openwebui',
    name: 'openwebui',
    status: 'public',
    summary: 'Browser chat UI for AI interaction.',
    details: 'Connects to ai-gateway for a cleaner model experience on the web.',
    role: 'AI workspace',
    uiUrl: 'https://chat.wnwest.com',
    docsUrl: '/services/openwebui/README.md',
  },
  {
    id: 'kitchen-ai',
    name: 'kitchen-ai',
    status: 'active',
    summary: 'Custom kitchen and household automation service.',
    details: 'A flexible custom app area for domain-specific AI and automation workflows.',
    role: 'custom app',
    uiUrl: 'https://kitchen-ai.wnwest.com',
    docsUrl: '/services/kitchen-ai/README.md',
  },
  {
    id: 'grocy',
    name: 'grocy',
    status: 'public',
    summary: 'Household inventory and pantry management.',
    details: 'Tracks pantry items and supports practical inventory workflows.',
    role: 'inventory',
    uiUrl: 'https://pantry.wnwest.com',
    docsUrl: '/services/grocy/README.md',
  },
  {
    id: 'mealie',
    name: 'mealie',
    status: 'public',
    summary: 'Recipe management and meal planning.',
    details: 'Stores recipes and supports planning around household food workflows.',
    role: 'recipes',
    uiUrl: 'https://recipes.wnwest.com',
    docsUrl: '/services/mealie/README.md',
  },
  {
    id: 'barcode-intake',
    name: 'barcode-intake',
    status: 'active',
    summary: 'Barcode scanner ingestion service.',
    details: 'Consumes host scanner input and pushes actions into Grocy.',
    role: 'automation',
    docsUrl: '/services/barcode-intake/README.md',
  },
  {
    id: 'filebrowser',
    name: 'filebrowser',
    status: 'public',
    summary: 'Web file browser for storage and media.',
    details: 'Exposes mounted content through a simple browser interface.',
    role: 'storage browser',
    uiUrl: 'https://files.wnwest.com',
    docsUrl: '/services/filebrowser/README.md',
  },
  {
    id: 'plex',
    name: 'plex',
    status: 'public',
    summary: 'Media server with persistent library state.',
    details: 'Runs on host networking and remains part of the public service surface.',
    role: 'media streaming',
    uiUrl: 'https://plex.wnwest.com',
    docsUrl: '/services/plex/README.md',
  },
  {
    id: 'torrents',
    name: 'torrents',
    status: 'public',
    summary: 'VPN-backed gluetun and qBittorrent stack.',
    details: 'Handles downloads through a dedicated VPN-routed service pair.',
    role: 'downloads',
    uiUrl: 'https://torrent.wnwest.com',
    docsUrl: '/services/torrents/README.md',
  },
  {
    id: 'minecraft',
    name: 'minecraft',
    status: 'active',
    summary: 'Forge server with persistent world data.',
    details: 'Runs as a dedicated game service with durable storage and exposed game port.',
    role: 'game server',
    docsUrl: '/services/minecraft/README.md',
  },
  {
    id: 'portainer',
    name: 'portainer',
    status: 'public',
    summary: 'Docker management UI.',
    details: 'Used for container, volume, and network visibility and control.',
    role: 'ops UI',
    uiUrl: 'https://portainer.wnwest.com',
    docsUrl: '/services/portainer/README.md',
  },
  {
    id: 'code-server',
    name: 'code-server',
    status: 'public',
    summary: 'Browser-based development workspace.',
    details: 'Provides direct access to a development environment against the host filesystem.',
    role: 'dev environment',
    uiUrl: 'https://code.wnwest.com',
    docsUrl: '/services/code-server/README.md',
  },
  {
    id: 'jupyter',
    name: 'jupyter',
    status: 'public',
    summary: 'Notebook workspace for experiments.',
    details: 'Supports scratch analysis, data work, and exploratory coding.',
    role: 'notebooks',
    uiUrl: 'https://jupyter.wnwest.com',
    docsUrl: '/services/jupyter/README.md',
  },
  {
    id: 'github-sync',
    name: 'github-sync',
    status: 'active',
    summary: 'Scheduled repository mirror.',
    details: 'Keeps configured Git content synced into local storage.',
    role: 'automation',
    docsUrl: '/services/github-sync/README.md',
  },
  {
    id: 'homeassistant',
    name: 'homeassistant',
    status: 'scaffold',
    summary: 'Reserved future Home Assistant boundary.',
    details: 'The target layout exists, but the service is intentionally not live in this stack yet.',
    role: 'future automation',
    docsUrl: '/services/homeassistant/README.md',
  },
  {
    id: 'samba',
    name: 'samba',
    status: 'scaffold',
    summary: 'Reserved future SMB sharing service.',
    details: 'Present as part of the platform plan, but not currently exposed as a live service.',
    role: 'future storage',
    docsUrl: '/services/samba/README.md',
  },
  {
    id: 'dashy',
    name: 'dashy',
    status: 'scaffold',
    summary: 'Reserved future dashboard surface.',
    details: 'A placeholder for a future dashboard or launch surface within the platform.',
    role: 'future dashboard',
    docsUrl: '/services/dashy/README.md',
  },
]

const statusStyles = {
  public: 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100',
  active: 'border-cyan-300/25 bg-cyan-300/10 text-cyan-100',
  infra: 'border-violet-300/25 bg-violet-300/10 text-violet-100',
  scaffold: 'border-white/15 bg-white/5 text-slate-300',
}

const runtimeStyles = {
  online: 'border-emerald-300/25 bg-emerald-300/10 text-emerald-100',
  degraded: 'border-amber-300/25 bg-amber-300/10 text-amber-100',
  offline: 'border-rose-300/25 bg-rose-300/10 text-rose-100',
  unprobed: 'border-slate-300/15 bg-slate-300/10 text-slate-200',
  scaffold: 'border-white/15 bg-white/5 text-slate-300',
  loading: 'border-cyan-300/20 bg-cyan-300/10 text-cyan-100',
}

const metricOptions = [
  { id: 'count', label: 'Row count' },
  { id: 'unique', label: 'Unique values' },
  { id: 'top', label: 'Top value' },
  { id: 'blank', label: 'Blank values' },
  { id: 'sum', label: 'Sum' },
  { id: 'avg', label: 'Average' },
  { id: 'min', label: 'Minimum' },
  { id: 'max', label: 'Maximum' },
]

const WORK_PRESET_STORAGE_KEY = 'westos-work-presets'

function ExternalArrow() {
  return <span aria-hidden="true">↗</span>
}

function StatusPill({ status }) {
  return (
    <span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.24em] ${statusStyles[status] || statusStyles.active}`}>
      {status}
    </span>
  )
}

function RuntimePill({ status }) {
  return (
    <span className={`rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.24em] ${runtimeStyles[status] || runtimeStyles.loading}`}>
      {status}
    </span>
  )
}

function parseCsv(text) {
  const rows = []
  let currentRow = []
  let currentValue = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const nextChar = text[index + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentValue += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(currentValue)
      currentValue = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        index += 1
      }
      currentRow.push(currentValue)
      rows.push(currentRow)
      currentRow = []
      currentValue = ''
      continue
    }

    currentValue += char
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    currentRow.push(currentValue)
    rows.push(currentRow)
  }

  return rows.filter((row) => row.some((cell) => String(cell || '').trim() !== ''))
}

function normalizeHeaders(rawHeaders) {
  const seen = {}
  return rawHeaders.map((header, index) => {
    const base = String(header || '').trim() || `Column ${index + 1}`
    if (!seen[base]) {
      seen[base] = 1
      return base
    }
    seen[base] += 1
    return `${base} ${seen[base]}`
  })
}

function toCsvDataset(text) {
  const parsed = parseCsv(text)
  if (!parsed.length) {
    return { headers: [], rows: [] }
  }

  const headers = normalizeHeaders(parsed[0])
  const rows = parsed.slice(1).map((row, rowIndex) => {
    const record = { __rowId: `${rowIndex}` }
    headers.forEach((header, headerIndex) => {
      record[header] = String(row[headerIndex] ?? '').trim()
    })
    return record
  })

  return { headers, rows }
}

function metricValue(rows, column, metric) {
  const numericValues = rows
    .map((row) => Number.parseFloat(String(row[column] ?? '').replace(/,/g, '')))
    .filter((value) => Number.isFinite(value))
  const values = rows.map((row) => String(row[column] ?? '').trim())

  if (metric === 'count') {
    return rows.length.toLocaleString()
  }

  if (metric === 'unique') {
    return new Set(values.filter(Boolean)).size.toLocaleString()
  }

  if (metric === 'blank') {
    return values.filter((value) => !value).length.toLocaleString()
  }

  if (metric === 'top') {
    const counts = values
      .filter(Boolean)
      .reduce((accumulator, value) => {
        accumulator[value] = (accumulator[value] || 0) + 1
        return accumulator
      }, {})

    const topEntry = Object.entries(counts).sort((left, right) => right[1] - left[1])[0]
    return topEntry ? `${topEntry[0]} (${topEntry[1]})` : 'n/a'
  }

  if (!numericValues.length) {
    return 'n/a'
  }

  if (metric === 'sum') {
    return numericValues.reduce((total, value) => total + value, 0).toLocaleString()
  }

  if (metric === 'avg') {
    return (numericValues.reduce((total, value) => total + value, 0) / numericValues.length).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    })
  }

  if (metric === 'min') {
    return Math.min(...numericValues).toLocaleString()
  }

  if (metric === 'max') {
    return Math.max(...numericValues).toLocaleString()
  }

  return 'n/a'
}

function parseDateValue(value) {
  const match = String(value || '').trim().match(
    /^(\d{2})-(\d{2})-(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)$/i,
  )
  if (!match) {
    return null
  }

  let [, month, day, year, hour, minute, second, meridiem] = match
  let normalizedHour = Number(hour)
  if (meridiem.toUpperCase() === 'PM' && normalizedHour !== 12) {
    normalizedHour += 12
  }
  if (meridiem.toUpperCase() === 'AM' && normalizedHour === 12) {
    normalizedHour = 0
  }

  const date = new Date(Number(year), Number(month) - 1, Number(day), normalizedHour, Number(minute), Number(second))
  return Number.isNaN(date.getTime()) ? null : date.getTime()
}

function compareValues(left, right) {
  const leftDate = parseDateValue(left)
  const rightDate = parseDateValue(right)
  if (leftDate !== null && rightDate !== null) {
    return leftDate - rightDate
  }

  const leftNumber = Number.parseFloat(String(left ?? '').replace(/,/g, ''))
  const rightNumber = Number.parseFloat(String(right ?? '').replace(/,/g, ''))
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber
  }

  return String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true, sensitivity: 'base' })
}

function formatDateInputValue(value) {
  const timestamp = parseDateValue(value)
  if (timestamp === null) {
    return ''
  }
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseFilterDateValue(value, edge) {
  if (!value) {
    return null
  }
  const date = new Date(`${value}T${edge === 'end' ? '23:59:59' : '00:00:00'}`)
  return Number.isNaN(date.getTime()) ? null : date.getTime()
}

function buildChartData(rows, column) {
  const counts = rows.reduce((accumulator, row) => {
    const key = String(row[column] || 'Blank').trim() || 'Blank'
    accumulator[key] = (accumulator[key] || 0) + 1
    return accumulator
  }, {})

  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([label, value]) => ({ label, value }))
}

function downloadTextFile(filename, contents) {
  const blob = new Blob([contents], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function toCsvString(headers, rows) {
  const escapeCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const lines = [
    headers.map(escapeCell).join(','),
    ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(',')),
  ]
  return lines.join('\n')
}

function useServiceStatuses() {
  const [serviceStatuses, setServiceStatuses] = useState({})
  const [summary, setSummary] = useState(null)

  useEffect(() => {
    let active = true

    async function loadStatuses() {
      try {
        const response = await fetch('/api/status/services')
        if (!response.ok) {
          throw new Error(`status ${response.status}`)
        }

        const payload = await response.json()
        if (!active) {
          return
        }

        const mapped = Object.fromEntries(payload.services.map((item) => [item.id, item]))
        setServiceStatuses(mapped)
        setSummary(payload.summary)
      } catch {
        if (!active) {
          return
        }
        setSummary({ error: true })
      }
    }

    loadStatuses()
    const intervalId = window.setInterval(loadStatuses, 30000)

    return () => {
      active = false
      window.clearInterval(intervalId)
    }
  }, [])

  return { serviceStatuses, summary }
}

function Logo() {
  return (
    <Link to="/" className="inline-flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-sm font-semibold text-white shadow-[0_0_40px_rgba(73,213,255,0.12)]">
        W
      </span>
      <span>
        <span className="block text-sm uppercase tracking-[0.28em] text-cyan-200/70">westOS</span>
        <span className="block text-xs text-slate-400">platform landing page</span>
      </span>
    </Link>
  )
}

function Nav({ current }) {
  const items = [
    { key: 'home', label: 'Home', to: '/' },
    { key: 'stack', label: 'Stack', to: '/stack' },
    { key: 'work', label: 'Work', to: '/work' },
  ]

  return (
    <div className="flex items-center gap-3 text-sm text-slate-300">
      {items.map((item) => (
        <Link
          key={item.key}
          to={item.to}
          className={`rounded-full px-4 py-2 transition ${
            current === item.key
              ? 'border border-white/10 bg-white/5 text-white hover:border-cyan-200/40 hover:bg-white/10'
              : 'hover:bg-white/5 hover:text-white'
          }`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
}

function Shell({ children }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#07111f] text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_28%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.12),transparent_24%),linear-gradient(180deg,#07111f_0%,#081321_45%,#050b14_100%)]" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/40 to-transparent" />
      <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] [background-size:96px_96px]" />
      <div className="relative">{children}</div>
    </div>
  )
}

function SectionHeading({ eyebrow, title, body }) {
  return (
    <div className="max-w-2xl">
      <p className="text-xs uppercase tracking-[0.32em] text-cyan-200/70">{eyebrow}</p>
      <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{title}</h2>
      <p className="mt-4 text-base leading-7 text-slate-300">{body}</p>
    </div>
  )
}

function Home() {
  const { summary } = useServiceStatuses()

  return (
    <main>
      <section className="px-6 pb-16 pt-8 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="sticky top-0 z-40 rounded-[28px] border border-white/10 bg-slate-950/55 px-5 py-4 backdrop-blur-xl">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <Logo />
              <Nav current="home" />
            </div>
          </div>

          <div className="grid gap-12 pb-14 pt-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-xs uppercase tracking-[0.32em] text-cyan-100/85">
                Public landing page for the westOS ecosystem
              </p>

              <h1 className="mt-8 max-w-4xl text-5xl font-semibold tracking-[-0.04em] text-white sm:text-6xl lg:text-7xl">
                One modern home for apps, AI, media, and self-hosted tools.
              </h1>

              <p className="mt-8 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
                `wnwest.com` is the public front door to <span className="text-white">westOS</span>, a modular platform for internal apps,
                AI services, household systems, media tooling, and infrastructure. It is designed to feel sharp, fast, and useful without
                overwhelming the page with noise.
              </p>

              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-400">
                Visitors should understand what the platform is, what runs inside it, and where the important surfaces live within a few seconds.
              </p>

              <div className="mt-10 flex flex-wrap gap-4">
                <Link to="/stack" className="rounded-full bg-white px-6 py-3 text-sm font-medium text-slate-950 transition hover:bg-cyan-100">
                  Explore the platform
                </Link>
                <a
                  href="https://github.com/williamneilwest/westOS"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-white/15 bg-white/5 px-6 py-3 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/10"
                >
                  View repository
                </a>
                <Link
                  to="/work"
                  className="rounded-full border border-white/15 bg-white/5 px-6 py-3 text-sm font-medium text-white transition hover:border-white/30 hover:bg-white/10"
                >
                  Open work tools
                </Link>
              </div>

              <div className="mt-8 flex flex-wrap gap-3 text-sm text-slate-300">
                {featuredLinks.map((item) =>
                  item.href.startsWith('/') ? (
                    <Link
                      key={item.label}
                      to={item.href}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 transition hover:border-cyan-200/35 hover:bg-white/[0.08] hover:text-white"
                    >
                      {item.label}
                    </Link>
                  ) : (
                    <a
                      key={item.label}
                      href={item.href}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 transition hover:border-cyan-200/35 hover:bg-white/[0.08] hover:text-white"
                    >
                      {item.label} <ExternalArrow />
                    </a>
                  ),
                )}
              </div>
            </div>

            <div className="relative">
              <div className="absolute -left-10 top-10 h-32 w-32 rounded-full bg-cyan-400/20 blur-3xl" />
              <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-emerald-300/10 blur-3xl" />
              <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_30px_120px_rgba(5,15,30,0.45)] backdrop-blur-xl">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Platform profile</p>
                    <p className="mt-2 text-xl font-medium text-white">westOS / public edge</p>
                  </div>
                  <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-emerald-100">
                    live
                  </span>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {metrics.map((metric) => (
                    <div key={metric.label} className="rounded-3xl border border-white/8 bg-slate-950/45 p-5">
                      <div className="text-3xl font-semibold tracking-tight text-white">{metric.value}</div>
                      <div className="mt-2 text-sm text-slate-400">{metric.label}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-6 rounded-[28px] border border-white/8 bg-gradient-to-br from-white/8 to-white/[0.03] p-5">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.28em] text-slate-400">
                    <span>Signal</span>
                    <span>Routing</span>
                  </div>
                  <div className="mt-4 space-y-4">
                    <div className="flex items-center justify-between rounded-2xl bg-slate-950/45 px-4 py-3">
                      <span className="text-sm text-slate-300">Runtime checks</span>
                      <span className="text-sm text-cyan-200">{summary ? `${summary.online} online` : 'checking'}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-2xl bg-slate-950/45 px-4 py-3">
                      <span className="text-sm text-slate-300">Failures detected</span>
                      <span className="text-sm text-emerald-200">{summary?.error ? 'unavailable' : summary ? `${summary.offline} offline` : 'loading'}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-2xl bg-slate-950/45 px-4 py-3">
                      <span className="text-sm text-slate-300">Public landing</span>
                      <span className="text-sm text-amber-100">default domain</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {pillars.map((pillar) => (
              <article key={pillar.title} className="rounded-[28px] border border-white/10 bg-white/[0.035] p-6 backdrop-blur">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-400">{pillar.eyebrow}</p>
                <h3 className="mt-4 text-xl font-medium text-white">{pillar.title}</h3>
                <p className="mt-3 leading-7 text-slate-300">{pillar.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-20 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            eyebrow="What Lives Here"
            title="A focused platform, not just a homepage."
            body="This page should explain the ecosystem at a glance: what the platform does, what kinds of products run inside it, and why the stack feels coherent."
          />

          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            {products.map((product) =>
              product.href.startsWith('/') ? (
                <Link
                  key={product.name}
                  to={product.href}
                  className="group relative overflow-hidden rounded-[32px] border border-white/10 bg-slate-950/50 p-8 transition hover:-translate-y-1 hover:border-white/20"
                >
                  <div className={`absolute inset-x-0 top-0 h-24 bg-gradient-to-r ${product.accent}`} />
                  <div className="relative">
                    <h3 className="text-2xl font-medium text-white">{product.name}</h3>
                    <p className="mt-4 max-w-xl leading-7 text-slate-300">{product.description}</p>
                    <div className="mt-5 text-sm font-medium text-cyan-200">Open {'->'}</div>
                  </div>
                </Link>
              ) : (
                <a
                  key={product.name}
                  href={product.href}
                  target="_blank"
                  rel="noreferrer"
                  className="group relative overflow-hidden rounded-[32px] border border-white/10 bg-slate-950/50 p-8 transition hover:-translate-y-1 hover:border-white/20"
                >
                  <div className={`absolute inset-x-0 top-0 h-24 bg-gradient-to-r ${product.accent}`} />
                  <div className="relative">
                    <h3 className="text-2xl font-medium text-white">{product.name}</h3>
                    <p className="mt-4 max-w-xl leading-7 text-slate-300">{product.description}</p>
                    <div className="mt-5 text-sm font-medium text-cyan-200">
                      Open <ExternalArrow />
                    </div>
                  </div>
                </a>
              ),
            )}
          </div>
        </div>
      </section>

      <section className="px-6 py-20 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <SectionHeading
            eyebrow="Highlights"
            title="Enough information to be useful."
            body="The homepage should help a new visitor orient quickly. These are the kinds of capabilities the platform is built around."
          />

          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            {highlights.map((item) => (
              <article key={item.title} className="rounded-[30px] border border-white/10 bg-white/[0.035] p-7 backdrop-blur">
                <p className="text-xs uppercase tracking-[0.28em] text-cyan-200/70">{item.label}</p>
                <h3 className="mt-4 text-2xl font-medium text-white">{item.title}</h3>
                <p className="mt-4 leading-7 text-slate-300">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}

function Stack() {
  const { serviceStatuses, summary } = useServiceStatuses()

  return (
    <main className="px-6 pb-20 pt-8 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <div className="sticky top-0 z-40 rounded-[28px] border border-white/10 bg-slate-950/55 px-5 py-4 backdrop-blur-xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <Logo />
            <Nav current="stack" />
          </div>
        </div>

        <div className="grid gap-10 py-14 lg:grid-cols-[0.9fr_1.1fr]">
          <SectionHeading
            eyebrow="Stack"
            title="The current service layer"
            body="Every service directory in westOS is listed here with its role, current state, live runtime indicator, docs, and UI link when a surface exists."
          />

          <div className="rounded-[32px] border border-white/10 bg-white/[0.035] p-4 backdrop-blur">
            <div className="grid gap-3">
              {featuredLinks.map((item) =>
                item.href.startsWith('/') ? (
                  <article
                    key={item.label}
                    className="grid gap-3 rounded-[24px] border border-white/8 bg-slate-950/45 px-5 py-5 sm:grid-cols-[1.1fr_0.7fr_1fr] sm:items-center"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">{item.label}</p>
                      <p className="mt-1 text-sm text-slate-400">{item.href}</p>
                    </div>
                    <div className="text-sm uppercase tracking-[0.22em] text-cyan-200/80">internal route</div>
                      <Link to={item.href} className="text-sm text-slate-300 transition hover:text-white">
                        Open {'->'}
                      </Link>
                  </article>
                ) : (
                  <article
                    key={item.label}
                    className="grid gap-3 rounded-[24px] border border-white/8 bg-slate-950/45 px-5 py-5 sm:grid-cols-[1.1fr_0.7fr_1fr] sm:items-center"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">{item.label}</p>
                      <p className="mt-1 text-sm text-slate-400">{item.href.replace('https://', '')}</p>
                    </div>
                    <div className="text-sm uppercase tracking-[0.22em] text-cyan-200/80">public link</div>
                    <a href={item.href} target="_blank" rel="noreferrer" className="text-sm text-slate-300 transition hover:text-white">
                      Open <ExternalArrow />
                    </a>
                  </article>
                ),
              )}
            </div>
          </div>
        </div>

        <div className="mb-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: 'online', value: summary?.online },
            { label: 'degraded', value: summary?.degraded },
            { label: 'offline', value: summary?.offline },
            { label: 'unprobed', value: summary?.unprobed },
            { label: 'scaffold', value: summary?.scaffold },
          ].map((item) => (
            <div key={item.label} className="rounded-[24px] border border-white/10 bg-white/[0.035] px-5 py-5 backdrop-blur">
              <div className="text-xs uppercase tracking-[0.28em] text-slate-500">{item.label}</div>
              <div className="mt-3 text-3xl font-semibold text-white">{item.value ?? '-'}</div>
            </div>
          ))}
        </div>

        <div className="mt-2 grid gap-5">
          {serviceDirectory.map((service) => (
            <article key={service.id} className="rounded-[32px] border border-white/10 bg-white/[0.035] p-6 backdrop-blur">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-3xl">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-2xl font-medium text-white">{service.name}</h3>
                    <StatusPill status={service.status} />
                    <RuntimePill status={serviceStatuses[service.id]?.status || 'loading'} />
                  </div>
                  <p className="mt-4 text-base leading-7 text-slate-300">{service.summary}</p>
                  <p className="mt-3 text-sm leading-7 text-slate-400">{service.details}</p>
                  <p className="mt-3 text-sm leading-7 text-slate-500">{serviceStatuses[service.id]?.note || 'Status check pending.'}</p>
                </div>

                <div className="rounded-[24px] border border-white/10 bg-slate-950/45 px-4 py-3 text-sm text-slate-300">
                  <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Role</div>
                  <div className="mt-2 text-white">{service.role}</div>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                {service.uiUrl ? (
                  <a
                    href={service.uiUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-sm text-white transition hover:border-cyan-200/35 hover:bg-white/[0.1]"
                  >
                    Open UI <ExternalArrow />
                  </a>
                ) : (
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-400">No direct UI</span>
                )}

                {service.extraUrl ? (
                  <a
                    href={service.extraUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-300 transition hover:border-white/25 hover:bg-white/[0.08] hover:text-white"
                  >
                    Alternate host <ExternalArrow />
                  </a>
                ) : null}

                {service.apiUrl ? (
                  <a
                    href={service.apiUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-300 transition hover:border-white/25 hover:bg-white/[0.08] hover:text-white"
                  >
                    API endpoint <ExternalArrow />
                  </a>
                ) : null}

                <a
                  href={service.docsUrl}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-300 transition hover:border-white/25 hover:bg-white/[0.08] hover:text-white"
                >
                  Service docs
                </a>
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  )
}

function Work() {
  const [headers, setHeaders] = useState([])
  const [rows, setRows] = useState([])
  const [filters, setFilters] = useState({})
  const [dateFilters, setDateFilters] = useState({})
  const [selectedMetricColumn, setSelectedMetricColumn] = useState('')
  const [enabledMetrics, setEnabledMetrics] = useState(['count', 'unique', 'top'])
  const [chartColumn, setChartColumn] = useState('')
  const [sortColumn, setSortColumn] = useState('')
  const [sortDirection, setSortDirection] = useState('asc')
  const [presetName, setPresetName] = useState('')
  const [savedPresets, setSavedPresets] = useState([])
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState('')

  const dateHeaders = headers.filter((header) => rows.some((row) => parseDateValue(row[header]) !== null))

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(WORK_PRESET_STORAGE_KEY)
      setSavedPresets(raw ? JSON.parse(raw) : [])
    } catch {
      setSavedPresets([])
    }
  }, [])

  const filteredRows = rows.filter((row) =>
    headers.every((header) => {
      if (dateHeaders.includes(header)) {
        const timestamp = parseDateValue(row[header])
        const from = parseFilterDateValue(dateFilters[header]?.from, 'start')
        const to = parseFilterDateValue(dateFilters[header]?.to, 'end')

        if (from !== null && (timestamp === null || timestamp < from)) {
          return false
        }
        if (to !== null && (timestamp === null || timestamp > to)) {
          return false
        }
      }

      const needle = String(filters[header] || '').trim().toLowerCase()
      if (!needle) {
        return true
      }
      return String(row[header] || '').toLowerCase().includes(needle)
    }),
  )

  const sortedRows = [...filteredRows].sort((left, right) => {
    if (!sortColumn) {
      return 0
    }
    const comparison = compareValues(left[sortColumn], right[sortColumn])
    return sortDirection === 'asc' ? comparison : -comparison
  })

  const visibleRows = sortedRows.slice(0, 250)
  const numericHeaders = headers.filter((header) =>
    rows.some((row) => Number.isFinite(Number.parseFloat(String(row[header] ?? '').replace(/,/g, '')))),
  )
  const chartData = chartColumn ? buildChartData(sortedRows, chartColumn) : []

  useEffect(() => {
    if (!selectedMetricColumn && numericHeaders.length) {
      setSelectedMetricColumn(numericHeaders[0])
    }
  }, [numericHeaders, selectedMetricColumn])

  useEffect(() => {
    const fallbackMetricColumn =
      headers.find((header) => ['state', 'assigned_to', 'assignment_group', 'priority', 'sys_class_name'].includes(header)) || headers[0] || ''

    if (!selectedMetricColumn && fallbackMetricColumn) {
      setSelectedMetricColumn(fallbackMetricColumn)
    }

    const fallbackChartColumn =
      headers.find((header) => ['state', 'assigned_to', 'assignment_group', 'priority'].includes(header)) || headers[0] || ''

    if (!chartColumn && fallbackChartColumn) {
      setChartColumn(fallbackChartColumn)
    }

    if (!sortColumn && headers.includes('opened_at')) {
      setSortColumn('opened_at')
      setSortDirection('desc')
    } else if (!sortColumn && headers[0]) {
      setSortColumn(headers[0])
    }
  }, [headers, selectedMetricColumn, chartColumn, sortColumn])

  function handleFileUpload(event) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result || '')
        const dataset = toCsvDataset(text)
        if (!dataset.headers.length) {
          throw new Error('No readable CSV columns were found.')
        }
        setHeaders(dataset.headers)
        setRows(dataset.rows)
        setFilters({})
        setDateFilters({})
        setError('')
        setFileName(file.name)
        setSortColumn('')
        setSortDirection('asc')
        setChartColumn('')
        setSelectedMetricColumn('')
      } catch (uploadError) {
        setHeaders([])
        setRows([])
        setFilters({})
        setDateFilters({})
        setFileName('')
        setError(uploadError.message || 'Could not parse CSV file.')
      }
    }
    reader.onerror = () => {
      setError('Could not read the selected file.')
    }
    reader.readAsText(file)
  }

  function toggleMetric(metricId) {
    setEnabledMetrics((current) =>
      current.includes(metricId) ? current.filter((item) => item !== metricId) : [...current, metricId],
    )
  }

  function savePreset() {
    const name = presetName.trim()
    if (!name) {
      return
    }

    const nextPresets = [
      { name, filters, dateFilters, sortColumn, sortDirection, chartColumn, selectedMetricColumn, enabledMetrics },
      ...savedPresets.filter((preset) => preset.name !== name),
    ].slice(0, 8)

    setSavedPresets(nextPresets)
    window.localStorage.setItem(WORK_PRESET_STORAGE_KEY, JSON.stringify(nextPresets))
    setPresetName('')
  }

  function loadPreset(preset) {
    setFilters(preset.filters || {})
    setDateFilters(preset.dateFilters || {})
    setSortColumn(preset.sortColumn || '')
    setSortDirection(preset.sortDirection || 'asc')
    setChartColumn(preset.chartColumn || '')
    setSelectedMetricColumn(preset.selectedMetricColumn || '')
    setEnabledMetrics(preset.enabledMetrics || ['count', 'unique', 'top'])
  }

  function deletePreset(name) {
    const nextPresets = savedPresets.filter((preset) => preset.name !== name)
    setSavedPresets(nextPresets)
    window.localStorage.setItem(WORK_PRESET_STORAGE_KEY, JSON.stringify(nextPresets))
  }

  function exportFilteredRows() {
    downloadTextFile(`${fileName.replace(/\.csv$/i, '') || 'filtered-data'}-filtered.csv`, toCsvString(headers, sortedRows))
  }

  function toggleSort(header) {
    if (sortColumn === header) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortColumn(header)
    setSortDirection('asc')
  }

  const agingSourceColumn = headers.includes('opened_at') ? 'opened_at' : dateHeaders[0] || ''
  const ageDays = sortedRows
    .map((row) => parseDateValue(row[agingSourceColumn]))
    .filter((value) => value !== null)
    .map((timestamp) => (Date.now() - timestamp) / (1000 * 60 * 60 * 24))

  const agingMetrics = {
    avg: ageDays.length ? (ageDays.reduce((sum, value) => sum + value, 0) / ageDays.length).toFixed(1) : 'n/a',
    max: ageDays.length ? Math.max(...ageDays).toFixed(1) : 'n/a',
    recent: ageDays.filter((value) => value <= 7).length.toLocaleString(),
  }

  return (
    <main className="px-6 pb-20 pt-8 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <div className="sticky top-0 z-40 rounded-[28px] border border-white/10 bg-slate-950/55 px-5 py-4 backdrop-blur-xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <Logo />
            <Nav current="work" />
          </div>
        </div>

        <div className="grid gap-10 py-14 lg:grid-cols-[0.9fr_1.1fr]">
          <SectionHeading
            eyebrow="Work Tools"
            title="Upload a CSV, filter anything, and pull quick metrics."
            body="This page is meant for practical work data. Upload a CSV, filter by any column, and choose the metrics you want based on the currently filtered result set."
          />

          <div className="rounded-[32px] border border-white/10 bg-white/[0.035] p-6 backdrop-blur">
            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex cursor-pointer rounded-full bg-white px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-cyan-100">
                Upload CSV
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileUpload} />
              </label>
              {fileName ? <span className="text-sm text-slate-300">{fileName}</span> : null}
              {headers.length ? (
                <button
                  type="button"
                  onClick={exportFilteredRows}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-5 py-3 text-sm text-slate-300 transition hover:border-white/25 hover:bg-white/[0.08] hover:text-white"
                >
                  Download filtered CSV
                </button>
              ) : null}
            </div>

            <p className="mt-5 text-sm leading-7 text-slate-400">
              Filtering and analysis run entirely in the browser. This is designed for quick inspection, not long pipeline jobs.
            </p>

            {error ? (
              <div className="mt-5 rounded-[24px] border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">{error}</div>
            ) : null}
          </div>
        </div>

        {!headers.length ? (
          <div className="rounded-[32px] border border-dashed border-white/15 bg-white/[0.03] px-8 py-12 text-center text-slate-400">
            Upload a CSV to start filtering rows and calculating metrics.
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[24px] border border-white/10 bg-white/[0.035] px-5 py-5 backdrop-blur">
                <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Rows loaded</div>
                <div className="mt-3 text-3xl font-semibold text-white">{rows.length.toLocaleString()}</div>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/[0.035] px-5 py-5 backdrop-blur">
                <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Rows visible</div>
                <div className="mt-3 text-3xl font-semibold text-white">{filteredRows.length.toLocaleString()}</div>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/[0.035] px-5 py-5 backdrop-blur">
                <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Columns</div>
                <div className="mt-3 text-3xl font-semibold text-white">{headers.length}</div>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/[0.035] px-5 py-5 backdrop-blur">
                <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Visible preview</div>
                <div className="mt-3 text-3xl font-semibold text-white">{visibleRows.length.toLocaleString()}</div>
              </div>
            </div>

            <div className="mt-8 rounded-[32px] border border-white/10 bg-white/[0.035] p-6 backdrop-blur">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="text-2xl font-medium text-white">Sorting and presets</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-400">Save common filter/sort views for recurring ticket analysis.</p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <select
                    value={sortColumn}
                    onChange={(event) => setSortColumn(event.target.value)}
                    className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-200/40"
                  >
                    {headers.map((header) => (
                      <option key={header} value={header}>
                        Sort: {header}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300 transition hover:border-white/25 hover:bg-white/[0.08] hover:text-white"
                  >
                    {sortDirection === 'asc' ? 'Ascending' : 'Descending'}
                  </button>
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3 xl:flex-row">
                <input
                  value={presetName}
                  onChange={(event) => setPresetName(event.target.value)}
                  placeholder="Preset name"
                  className="w-full rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-200/40"
                />
                <button
                  type="button"
                  onClick={savePreset}
                  className="rounded-2xl bg-white px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-cyan-100"
                >
                  Save preset
                </button>
              </div>

              {savedPresets.length ? (
                <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {savedPresets.map((preset) => (
                    <div key={preset.name} className="rounded-[24px] border border-white/10 bg-slate-950/45 p-4">
                      <div className="text-sm font-medium text-white">{preset.name}</div>
                      <div className="mt-2 text-xs uppercase tracking-[0.24em] text-slate-500">
                        {preset.sortColumn || 'No sort'} / {preset.sortDirection || 'asc'}
                      </div>
                      <div className="mt-4 flex gap-3">
                        <button
                          type="button"
                          onClick={() => loadPreset(preset)}
                          className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-300 transition hover:border-white/25 hover:bg-white/[0.08] hover:text-white"
                        >
                          Load
                        </button>
                        <button
                          type="button"
                          onClick={() => deletePreset(preset.name)}
                          className="rounded-full border border-rose-300/20 bg-rose-300/10 px-4 py-2 text-sm text-rose-100 transition hover:bg-rose-300/15"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <div className="rounded-[24px] border border-white/10 bg-white/[0.035] px-5 py-5 backdrop-blur">
                <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Average age</div>
                <div className="mt-3 text-3xl font-semibold text-white">{agingMetrics.avg}</div>
                <div className="mt-2 text-sm text-slate-400">days since {agingSourceColumn || 'date source'}</div>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/[0.035] px-5 py-5 backdrop-blur">
                <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Oldest item</div>
                <div className="mt-3 text-3xl font-semibold text-white">{agingMetrics.max}</div>
                <div className="mt-2 text-sm text-slate-400">days open in filtered set</div>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/[0.035] px-5 py-5 backdrop-blur">
                <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Opened in last 7 days</div>
                <div className="mt-3 text-3xl font-semibold text-white">{agingMetrics.recent}</div>
                <div className="mt-2 text-sm text-slate-400">filtered items</div>
              </div>
            </div>

            <div className="mt-8 rounded-[32px] border border-white/10 bg-white/[0.035] p-6 backdrop-blur">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="text-2xl font-medium text-white">Metrics</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-400">Pick a column and turn on the metrics you want to see. Categorical metrics work well for ticket exports like the sample you shared.</p>
                </div>

                <select
                  value={selectedMetricColumn}
                  onChange={(event) => setSelectedMetricColumn(event.target.value)}
                  className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-200/40"
                >
                  {headers.length ? (
                    headers.map((header) => (
                      <option key={header} value={header}>
                        {header}
                      </option>
                    ))
                  ) : (
                    <option value="">No columns detected</option>
                  )}
                </select>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                {metricOptions.map((metric) => (
                  <button
                    key={metric.id}
                    type="button"
                    onClick={() => toggleMetric(metric.id)}
                    className={`rounded-full border px-4 py-2 text-sm transition ${
                      enabledMetrics.includes(metric.id)
                        ? 'border-cyan-200/35 bg-cyan-300/10 text-cyan-100'
                        : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25 hover:bg-white/[0.08] hover:text-white'
                    }`}
                  >
                    {metric.label}
                  </button>
                ))}
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {enabledMetrics.map((metricId) => {
                  const metric = metricOptions.find((item) => item.id === metricId)
                  return (
                    <div key={metricId} className="rounded-[24px] border border-white/10 bg-slate-950/45 px-5 py-5">
                      <div className="text-xs uppercase tracking-[0.28em] text-slate-500">{metric?.label}</div>
                      <div className="mt-3 text-3xl font-semibold text-white">
                        {selectedMetricColumn ? metricValue(filteredRows, selectedMetricColumn, metricId) : 'n/a'}
                      </div>
                      <div className="mt-2 text-sm text-slate-400">{selectedMetricColumn || 'Select a numeric column'}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="mt-8 rounded-[32px] border border-white/10 bg-white/[0.035] p-6 backdrop-blur">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="text-2xl font-medium text-white">Chart</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-400">Visualize the filtered result set by any categorical column.</p>
                </div>

                <select
                  value={chartColumn}
                  onChange={(event) => setChartColumn(event.target.value)}
                  className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-200/40"
                >
                  {headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-6 space-y-4">
                {chartData.map((item) => {
                  const maxValue = chartData[0]?.value || 1
                  const width = `${(item.value / maxValue) * 100}%`
                  return (
                    <div key={item.label}>
                      <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                        <span className="truncate text-slate-300">{item.label}</span>
                        <span className="text-white">{item.value}</span>
                      </div>
                      <div className="h-3 rounded-full bg-slate-950/60">
                        <div className="h-3 rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300" style={{ width }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="mt-8 rounded-[32px] border border-white/10 bg-white/[0.035] p-6 backdrop-blur">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h3 className="text-2xl font-medium text-white">Data preview</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-400">
                    Showing {visibleRows.length.toLocaleString()} of {filteredRows.length.toLocaleString()} filtered rows.
                  </p>
                </div>
                {filteredRows.length > visibleRows.length ? (
                  <div className="text-sm text-amber-100">Preview capped at 250 rows for readability.</div>
                ) : null}
              </div>

              <div className="mt-6 overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-y-2 text-left text-sm">
                  <thead>
                    <tr>
                      {headers.map((header) => (
                        <th key={header} className="px-4 py-2 align-top text-xs uppercase tracking-[0.24em] text-slate-500">
                          <div className="min-w-[180px]">
                            <button
                              type="button"
                              onClick={() => toggleSort(header)}
                              className="flex items-center gap-2 whitespace-nowrap transition hover:text-white"
                            >
                              {header}
                              {sortColumn === header ? (sortDirection === 'asc' ? '↑' : '↓') : null}
                            </button>
                            {dateHeaders.includes(header) ? (
                              <div className="mt-3 grid gap-2">
                                <input
                                  type="date"
                                  value={dateFilters[header]?.from || ''}
                                  onChange={(event) =>
                                    setDateFilters((current) => ({
                                      ...current,
                                      [header]: { ...current[header], from: event.target.value },
                                    }))
                                  }
                                  className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-[11px] normal-case tracking-normal text-white outline-none transition focus:border-cyan-200/40"
                                />
                                <input
                                  type="date"
                                  value={dateFilters[header]?.to || ''}
                                  onChange={(event) =>
                                    setDateFilters((current) => ({
                                      ...current,
                                      [header]: { ...current[header], to: event.target.value },
                                    }))
                                  }
                                  className="rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-[11px] normal-case tracking-normal text-white outline-none transition focus:border-cyan-200/40"
                                />
                              </div>
                            ) : (
                              <input
                                value={filters[header] || ''}
                                onChange={(event) => setFilters((current) => ({ ...current, [header]: event.target.value }))}
                                placeholder="Filter"
                                className="mt-3 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-[11px] normal-case tracking-normal text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-200/40"
                              />
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={row.__rowId} className="bg-slate-950/45">
                        {headers.map((header) => (
                          <td key={`${row.__rowId}-${header}`} className="max-w-[280px] rounded-xl px-4 py-3 align-top text-slate-200">
                            <div className="truncate">{row[header] || '—'}</div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  )
}

function App() {
  return (
    <Router>
      <Shell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/stack" element={<Stack />} />
          <Route path="/work" element={<Work />} />
        </Routes>
      </Shell>
    </Router>
  )
}

export default App
