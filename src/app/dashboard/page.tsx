import { CreateModal } from '@/components/dashboard/create-modal';
import { ProjectCard } from '@/components/dashboard/project-card';
import { createSupabaseServerClient } from '@/lib/supabase-server';

type ProjectSummary = {
  id: string;
  name: string;
  updatedAt: string;
  status: string;
};

async function getProjects(): Promise<ProjectSummary[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('projects')
    .select('id, name, updated_at, status')
    .order('updated_at', { ascending: false });

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    updatedAt: new Date(row.updated_at as string).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
    status: String(row.status ?? 'Draft'),
  }));
}

export default async function DashboardPage() {
  const projects = await getProjects();

  return (
    <section className="space-y-8 px-6 py-8 lg:px-10">
      <header className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-6 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <p className="text-sm uppercase tracking-[0.3em] text-sky-300">Dashboard</p>
          <h1 className="text-3xl font-semibold text-white">Project control room</h1>
          <p className="text-slate-300">
            {projects.length === 0
              ? 'No projects yet — create your first one below.'
              : `${projects.length} project${projects.length === 1 ? '' : 's'} in your workspace.`}
          </p>
        </div>
        <CreateModal />
      </header>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </section>
  );
}
