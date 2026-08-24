import { DashboardWorkspace, type ProjectLog } from '@/components/dashboard/dashboard-workspace';
import { createSupabaseServerClient } from '@/lib/supabase-server';

async function getProjectLogs(): Promise<ProjectLog[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('project_logs')
    .select('id, project_name, repository, branch, status, description, tech_stack, latest_activity')
    .order('updated_at', { ascending: false });

  if (error || !data) {
    // The table may not exist yet. An empty workspace is a better landing than
    // an error page, and adding a project still works once the schema is run.
    if (error) {
      // eslint-disable-next-line no-console
      console.error('Could not load project logs:', error.message);
    }
    return [];
  }

  return data as ProjectLog[];
}

export default async function DashboardPage() {
  const projects = await getProjectLogs();

  return <DashboardWorkspace initialProjects={projects} />;
}
