import { ProjectsProvider } from "../../ProjectsContext";
import Workspace from "../../components/workspace/Workspace";

export default async function ProjectWorkspacePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <ProjectsProvider>
      <Workspace projectId={projectId} />
    </ProjectsProvider>
  );
}
