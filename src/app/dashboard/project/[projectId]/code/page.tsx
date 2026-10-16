import CodeEditor from "../../../components/workspace/CodeEditor";

/* The project's code in a VS Code–style editor, opened in its own tab from the
   workspace's </> button. */
export default async function ProjectCodePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <CodeEditor projectId={projectId} />;
}
