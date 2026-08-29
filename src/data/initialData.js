export const initialProfile = {
  username: "micheledallida",
  displayName: "Michele Dallida",
  avatar_url: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=150&h=150&q=80",
  bio: "Full-stack Developer, Devops Engineer & AI Integrator focused on rapid prototype deployments & scalable web architectures.",
  stats: {
    total_commits: "1,429",
    successful_deploys: "342",
    solved_incidents: "47",
    uptime_rate: "99.98%"
  },
  dated_events_projects_plans: [
    {
      id: "project-qs-ai",
      project_name: "Quickstark.Ai",
      repository: "micheledallida-web/V10",
      branch: "main",
      status: "active_development",
      description: "A cutting-edge rapid prototyping assistant generating dynamic React components with integrated micro-services.",
      tech_stack: ["Next.js", "Vercel", "TailwindCSS", "OpenAI API", "Prisma"],
      latest_activity: {
        timestamp: "2026-07-19T04:37:46Z",
        type: "vercel_deployment_troubleshooting",
        issue: "Vercel framework auto-detection failed to identify Next.js despite package.json residing in the repository root directory.",
        resolution_provided: "Instructed manual override of the Framework Preset to Next.js within Vercel project build settings while maintaining a root directory path of ./ to trigger a successful project compilation.",
        status: "resolved"
      }
    },
    {
      id: "project-nexus-api",
      project_name: "Nexus API Gateway",
      repository: "micheledallida-web/nexus-core",
      branch: "production",
      status: "shipped",
      description: "High throughput rate-limiting proxy with real-time analytics streaming built for sub-millisecond route resolution.",
      tech_stack: ["Go", "Redis", "Docker", "AWS ECS"],
      latest_activity: {
        timestamp: "2026-06-12T14:22:10Z",
        type: "infrastructure_upgrade",
        issue: "Redis cache eviction storm caused brief degradation during concurrent query peaks.",
        resolution_provided: "Modified memory policy to volatile-lru and doubled memory pool limits on Redis Cluster sidecars.",
        status: "resolved"
      }
    },
    {
      id: "project-quantum-db",
      project_name: "Quantum Sync Database",
      repository: "micheledallida-web/quantum-sync",
      branch: "beta-testing",
      status: "paused",
      description: "Local-first CRDT-backed real-time database that automatically synchronizes schema migrations across distributed clients.",
      tech_stack: ["Rust", "WASM", "SQLite", "WebSockets"],
      latest_activity: {
        timestamp: "2026-05-30T09:15:00Z",
        type: "schema_mismatch",
        issue: "WASM build failing on client-side compilation for older arm64 environments.",
        resolution_provided: "Implemented a conditional polyfill build for standard browser runtime detection protocols.",
        status: "paused"
      }
    }
  ]
};