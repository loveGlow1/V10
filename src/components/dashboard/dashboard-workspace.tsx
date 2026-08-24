'use client';

import { useMemo, useState } from 'react';
import { FolderGit2, Rocket, AlertTriangle, Plus } from 'lucide-react';

import MetricCard from '@/components/MetricCard';
import ProjectLogCard from '@/components/ProjectLogCard';
import AddLogModal from '@/components/AddLogModal';
import DeploymentTroubleshooter from '@/components/DeploymentTroubleshooter';
import { createSupabaseBrowserClient, isSupabaseConfigured } from '@/lib/supabase';

export type ProjectLog = {
  id: string;
  project_name: string;
  repository: string;
  branch: string;
  status: string;
  description: string | null;
  tech_stack: string[];
  latest_activity: {
    timestamp?: string;
    type?: string;
    issue?: string;
    resolution_provided?: string;
    status?: string;
  } | null;
};

export function DashboardWorkspace({ initialProjects }: { initialProjects: ProjectLog[] }) {
  const [projects, setProjects] = useState<ProjectLog[]>(initialProjects);
  const [activeId, setActiveId] = useState<string | null>(initialProjects[0]?.id ?? null);
  const [modalOpen, setModalOpen] = useState(false);

  const activeProject = projects.find((project) => project.id === activeId) ?? null;

  const metrics = useMemo(() => {
    const shipped = projects.filter((project) => project.status === 'shipped').length;
    const unresolved = projects.filter(
      (project) => project.latest_activity && project.latest_activity.status !== 'resolved',
    ).length;
    return { total: projects.length, shipped, unresolved };
  }, [projects]);

  async function handleSave(newProject: ProjectLog) {
    // Show it straight away, then reconcile with whatever the database
    // actually stored — the row comes back with its own id and timestamps.
    setProjects((current) => [newProject, ...current]);
    setActiveId(newProject.id);

    if (!isSupabaseConfigured) return;
    const supabase = createSupabaseBrowserClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('project_logs')
      .insert({
        user_id: user.id,
        project_name: newProject.project_name,
        repository: newProject.repository,
        branch: newProject.branch,
        status: newProject.status,
        description: newProject.description,
        tech_stack: newProject.tech_stack,
        latest_activity: newProject.latest_activity,
      })
      .select('id, project_name, repository, branch, status, description, tech_stack, latest_activity')
      .single();

    if (error || !data) {
      // eslint-disable-next-line no-console
      console.error('Could not save project log:', error);
      return;
    }

    setProjects((current) => current.map((project) => (project.id === newProject.id ? (data as ProjectLog) : project)));
    setActiveId(data.id as string);
  }

  async function handleResolveIssue(projectId: string) {
    const target = projects.find((project) => project.id === projectId);
    if (!target) return;

    const resolved = {
      ...target,
      latest_activity: { ...(target.latest_activity ?? {}), status: 'resolved' },
    };
    setProjects((current) => current.map((project) => (project.id === projectId ? resolved : project)));

    if (!isSupabaseConfigured) return;
    const { error } = await createSupabaseBrowserClient()
      .from('project_logs')
      .update({ latest_activity: resolved.latest_activity })
      .eq('id', projectId);

    if (error) {
      // eslint-disable-next-line no-console
      console.error('Could not mark the issue resolved:', error);
    }
  }

  return (
    <div className="space-y-8 px-6 py-8 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-sky-300">Projects</p>
          <h2 className="mt-2 text-3xl font-semibold text-white">Build log</h2>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
        >
          <Plus className="h-4 w-4" />
          Add project
        </button>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard title="Projects" value={metrics.total} subtext="tracked in this workspace" icon={FolderGit2} />
        <MetricCard title="Shipped" value={metrics.shipped} subtext="live in production" icon={Rocket} colorClass="from-emerald-600 to-teal-600" />
        <MetricCard title="Open issues" value={metrics.unresolved} subtext="awaiting a fix" icon={AlertTriangle} colorClass="from-amber-600 to-orange-600" />
      </div>

      {projects.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-10 text-center">
          <p className="text-slate-300">No projects logged yet.</p>
          <p className="mt-1 text-sm text-slate-500">Add one to start tracking builds and deployments.</p>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <ProjectLogCard
              key={project.id}
              project={project}
              isActive={project.id === activeId}
              onSelect={() => setActiveId(project.id)}
            />
          ))}
        </div>
      )}

      {activeProject ? (
        <DeploymentTroubleshooter activeProject={activeProject} onResolveIssue={handleResolveIssue} />
      ) : null}

      <AddLogModal isOpen={modalOpen} onClose={() => setModalOpen(false)} onSave={handleSave} />
    </div>
  );
}
