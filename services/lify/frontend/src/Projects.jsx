import './App.css'

function Projects() {
  return (
    <div className="container">
      <h1>Projects</h1>

      <div className="card">
        <h3>Homelab Infrastructure</h3>
        <p>
          Full Docker-based homelab using Caddy reverse proxy, SSL automation,
          Home Assistant integrations, and VPN-routed containers.
        </p>
      </div>

      <div className="card">
        <h3>Automation & Labeling System</h3>
        <p>
          Built automation workflows using Power Automate, Python, and Zebra printers
          to streamline asset tracking and labeling.
        </p>
      </div>

      <div className="card">
        <h3>Custom Web Applications</h3>
        <p>
          Flask + React apps for PDF processing, JSON extraction, and dashboard visualization.
        </p>
      </div>
    </div>
  )
}

export default Projects
