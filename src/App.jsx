import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom'

function Card({ title, children }) {
  return (
    <div className="bg-slate-800/70 backdrop-blur p-6 rounded-2xl shadow-lg transition transform hover:-translate-y-2 hover:shadow-2xl hover:bg-slate-800/90">
      <h3 className="text-lg font-semibold mb-2 text-white">{title}</h3>
      <div className="text-slate-300">{children}</div>
    </div>
  )
}

function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white px-6 py-12">
      <div className="max-w-4xl mx-auto">

        {/* HERO */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-extrabold bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
            William West
          </h1>

          <p className="text-slate-400 mt-3 text-lg">
            IT Automation Specialist • Systems Engineer • Builder
          </p>
        </div>

        {/* ABOUT */}
        <div className="mb-8">
          <Card title="About Me">
            <p>
              William West is an IT Automation Specialist in Colorado focused on building scalable systems using 
              Power Platform, ServiceNow, Docker, and DevOps practices.
            </p>
            <p className="mt-2">
              I specialize in automation, infrastructure, and eliminating manual processes through smart system design.
            </p>
          </Card>
        </div>

        {/* PROJECT PREVIEW */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">

          <Link to="/projects">
            <Card title="Projects">
              Explore my homelab, automation systems, and full-stack applications.

              <div className="mt-3 text-blue-400 font-medium">
                View Projects →
              </div>
            </Card>
          </Link>

          <Card title="Resume">
            <a
              href="/resume.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 font-medium"
            >
              Download Resume →
            </a>
          </Card>

        </div>

      </div>
    </div>
  )
}

function Projects() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white px-6 py-12">
      <div className="max-w-4xl mx-auto">

        <h1 className="text-4xl font-bold mb-8 text-center bg-gradient-to-r from-blue-400 to-cyan-300 bg-clip-text text-transparent">
          Projects
        </h1>

        <div className="grid md:grid-cols-2 gap-6">

          {/* HOMELAB */}
          <Card title="Homelab Infrastructure">
            <p>
              Docker-based environment with Caddy reverse proxy, SSL automation,
              Home Assistant integration, and VPN-isolated services.
            </p>

            <p className="text-slate-500 text-sm mt-2">
              Self-hosted infrastructure powering automation tools, dashboards, and smart home systems.
            </p>

            <div className="mt-4">
              <a
                href="https://pridebytes.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 font-medium"
              >
                View Live Homelab →
              </a>
            </div>
          </Card>

          {/* AUTOMATION */}
          <Card title="Automation & Labeling System">
            <p>
              Built Power Automate + Python workflows to generate and print asset labels
              using Zebra printers and barcode scanners.
            </p>
          </Card>

          {/* WEB APPS */}
          <Card title="Custom Web Applications">
            <p>
              Developed Flask + React applications for PDF processing, JSON extraction,
              and internal dashboards.
            </p>
          </Card>

          {/* SMART HOME */}
          <Card title="Smart Home Automation">
            <p>
              Home Assistant setup integrating Zigbee, HomeKit, and custom automations
              for real-time device control and monitoring.
            </p>
          </Card>

        </div>

      </div>
    </div>
  )
}

function App() {
  return (
    <Router>

      {/* NAV */}
      <nav className="bg-slate-900/80 backdrop-blur text-white px-6 py-4 sticky top-0 z-50 border-b border-slate-700">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <Link to="/" className="font-bold text-lg text-blue-400">
            wnwest
          </Link>

          <div className="space-x-6">
            <Link to="/" className="hover:text-blue-400 transition">Home</Link>
            <Link to="/projects" className="hover:text-blue-400 transition">Projects</Link>
          </div>
        </div>
      </nav>

      {/* ROUTES */}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/projects" element={<Projects />} />
      </Routes>

    </Router>
  )
}

export default App
