import { NextResponse } from "next/server";

import {
  CREDIT_ACTIONS,
  PLANS,
  affordableModels,
  buildDoorFor,
  canAfford,
  cannotAffordBuildMessage,
  contextSurcharge,
  creditCostOf,
  roundCredits,
  downgradedModelMessage,
  formatCredits,
  modelAllowedOnPlan,
  modelsForPlan,
  planRequiredFor,
  resolveBuildModel,
} from "@/app/dashboard/credits";
import {
  attachmentBlocks,
  attachmentText,
  imagePlacements,
  loadAttachments,
  placeAttachments,
  signedImageUrls,
} from "@/lib/builder/attachments";
import { readPage, regressions } from "@/lib/builder/brain";
import {
  advancesStage,
  carryBrief,
  conversational,
  countWords,
  describesNothing,
  isContinuation,
  isWholeRebuild,
  priorTurns,
} from "@/lib/builder/brief";
import { previewUrl as publishPreviewUrl } from "@/lib/publish/naming";
import {
  asksForLogoResize,
  asksForLogoSwap,
  describeResize,
  listOf,
  resizeLogo,
  resizeLogoInTree,
  resizeScope,
  swapLogo,
  swapLogoInTree,
} from "@/lib/builder/logo-swap";
import { reserveSlug } from "@/lib/publish/reserve";
import { wantsDownload } from "@/lib/builder/download";
import {
  EDIT_MODEL,
  EditError,
  answerQuestion,
  chargedModel,
  fallbackNote,
  servedLog,
  askClarifying,
  editDeadline,
  editModelFor,
  editPage,
  editSource,
  pickFile,
  type OnProgress,
} from "@/lib/builder/edit";
import { estimateTokens } from "@/lib/context/budget";
import { extractRequirements } from "@/lib/context/compress";
import { decompose, describeDecomposition } from "@/lib/context/decompose";
import { describeExpansion, expandContext } from "@/lib/context/expand";
import { describePlan } from "@/lib/context/fit";
import { fitBrief, fitEdit } from "@/lib/context/requests";
import {
  advance,
  currentStage,
  describeProgress,
  isFinished,
  pathForStage,
  planFrom,
  stageInstruction,
  stagePlanBrief,
} from "@/lib/context/stages";
import { describeState, readCache, writeCache } from "@/lib/context/state";
import {
  readContext,
  readProjectIndex,
  recordCheckpoint,
  saveContext,
  writeProjectIndex,
} from "@/lib/context/store";
import { intakeAttachments } from "@/lib/builder/assets/asset-intake";
import { planAssets } from "@/lib/builder/assets/asset-planner";
import { describeRegistry, duplicatesIn } from "@/lib/builder/assets/asset-registry";
import { resolveAssets, resolvedPhotographs } from "@/lib/builder/assets/asset-resolver";
import { loadAssets, recordAsset } from "@/lib/builder/assets/asset-storage";
import { usableProviders } from "@/lib/builder/assets/providers/registry";
import { composeBuildPrompt } from "@/lib/builder/blueprints";
import {
  type ArchitectureManifest,
  architectureFromChoice,
  describeUpgrade,
  type Layer,
  LAYERS,
  raiseArchitecture,
  architectureOptions,
  architectureQuestion,
  decideArchitecture,
  describeArchitecture,
  isArchitectureChoice,
  UNKNOWN_ARCHITECTURE,
  databaseChoice,
} from "@/lib/builder/architecture";
import { decideDesign, systemByName } from "@/lib/builder/design";
import { allIssues, runQaLoop } from "@/lib/builder/qa";
import { describeEdit, editPlanBrief, planEdit } from "@/lib/builder/edit-plan";
import { reframe } from "@/lib/builder/framing";
import { landmarkBrief } from "@/lib/builder/landmarks";
import { referenceEditBrief } from "@/lib/builder/reference";
import { loadReferencedProjects, referenceText } from "@/lib/builder/project-reference";
import { refuseWithoutCard } from "@/lib/card-gate";
import { FLIER_INTENT, isFlierTarget, startFlierTurn } from "@/lib/flyers/workspace";
import { VIDEO_INTENT, startVideoTurn } from "@/lib/video/workspace";
import { moveVideoVersion } from "@/lib/video/versions";
import { moveFlierVersion } from "@/lib/flyers/versions";
import { authorSchema, withAuthored } from "@/lib/builder/app-schema";
import { ensureBackendFor, envFor, resolveBackend } from "@/lib/builder/backend/connection";
import { offered as managedOffered } from "@/lib/builder/backend/managed";
import { oauthConfigured } from "@/lib/builder/backend/supabase-oauth";
import { CONNECT_SUPABASE_LABEL, connectSupabaseHref } from "@/lib/builder/backend/connect-link";
import { MODE_BLURB, MODE_LABEL } from "@/lib/builder/backend/modes";
import { commerceBrief } from "@/lib/builder/commerce";
import { connectedServices, integrationBrief } from "@/lib/builder/integrations";
import { describeProvision, provisionChecked } from "@/lib/builder/backend/provision";
import { upgradeCapabilities } from "@/lib/builder/capability-upgrade";
import {
  connectButtonFor,
  connectDatabaseHref,
  isPageDataAsk,
  preparePageData,
} from "@/lib/builder/backend/page-data";
import { memberAreaFor } from "@/lib/builder/member-area";
import { retuneBuild, treeBrief } from "@/lib/builder/scaffold";
import { blocking, inspectStructure, repairStructure } from "@/lib/builder/next-structure";
import {
  asksForImages,
  ensureImageSources,
  hasPlaceholders,
  upgradePlaceholders,
} from "@/lib/builder/tree-images";
import { providerFromEnv } from "@/lib/builder/image-providers";
import { searchContext } from "@/lib/builder/images";
import { previouslyUsedPhotos } from "@/lib/builder/photo-memory";
import { projectPhotoUrls } from "@/lib/builder/photo-memory";
import { currentTree, storeTree, storedTreeAsOf } from "@/lib/builder/store-tree";
import {
  describeRecent,
  describeVersions,
  formatWhen,
  listVersions,
  parseTarget as parseVersionTarget,
  readVersionRequest,
  recentDistinct,
  resolveTarget as resolveVersionTarget,
  REDO_ASK,
  redoTarget,
  restorePrompt,
  safeTimeZone,
  termsOf,
  versionsShowing,
} from "@/lib/builder/versions";
import { type FileTree, isSinglePage } from "@/lib/builder/tree";
import { commonModulesFor, modulesFor, presetFor, publicationModulesFor, staffFor, uploadsBucket, withStaff } from "@/lib/builder/presets";
import {
  describeTables,
  formatRows,
  generateSql,
  isDatabaseAsk,
  judgeSql,
  sqlFromMessage,
  wrapSql,
} from "@/lib/builder/backend/database-ask";
import { parseSnapshot, snapshotSql } from "@/lib/builder/backend/inspect";
import { runnerFor } from "@/lib/builder/backend/schema-sync";
import {
  NEW_PROJECT_COST,
  analysisMessage,
  diagnose,
  planChange,
  planOwnerOnly,
  planUndo,
  scanDatabase,
  wireApp,
  wiredBriefFor,
} from "@/lib/builder/backend/agent/service";
import { agentCommand } from "@/lib/builder/backend/agent/commands";
import { describeMap } from "@/lib/builder/backend/agent/db-map";
import { readOnlyCheck, tokenize as tokenizeSql } from "@/lib/builder/backend/agent/sql-guard";
import { dbToolsFor } from "@/lib/builder/backend/agent/tools";
import { asData, flagRows } from "@/lib/builder/backend/agent/untrusted";
import {
  type FeatureAsk,
  appFeatureFor,
  featureBrief,
  featureFor,
  restyleBrief,
  restyleFor,
  upgradeBrief,
  upgradeOffer,
} from "@/lib/builder/feature";
import { indexTree, retrieve } from "@/lib/context/project-index";
import {
  deploymentName,
  deploymentsConfigured,
  projectSecretNames,
  startDeployment,
  vercelCredentials,
} from "@/lib/publish/vercel-deploy";
import { existingVercelProject, recordDeployment } from "@/lib/publish/deployment-store";
import { diagnoseFindings } from "@/lib/publish/diagnosis";
import { shouldRedeploy } from "@/lib/publish/redeploy";
import type { PublishState } from "@/lib/project-status";
import { bucketName, dataModelFor, schemaNameFor } from "@/lib/builder/schema";
import { type Stack, decideStack, stackOptions, stackQuestion } from "@/lib/builder/stack";
import { classifyKind } from "@/lib/builder/classify-kind";
import {
  asksToConnectBackend,
  classifyIntent,
  type Intent,
  remainderAfterRevert,
  VISUAL_PICK,
} from "@/lib/builder/intent";
import {
  bestKindGuess,
  familyOf,
  BUILD_KINDS,
  heuristicKind,
  isBuildKind,
  KIND_BLURB,
  KIND_LABEL,
  type KindResult,
} from "@/lib/builder/kinds";
import {
  CATEGORY_LABEL,
  comingSoonMessage,
  isComingSoon,
  parseTarget,
  resolveTarget,
  targetBrief,
} from "@/lib/builder/targets";
import { builderAvailability } from "@/lib/builder/availability";
import { detectMarket, isMarket } from "@/lib/builder/market";
import {
  DEFAULT_MODEL,
  PROVIDER_LABEL,
  creditMultiplierFor,
  modelById,
  resolveModel,
} from "@/app/dashboard/models";
import { generationRequest, providerConfigured, userMessage } from "@/lib/builder/model-request";
import { stepRecorder, type BuildStep, type StepSink } from "@/lib/builder/steps";
import {
  checkpointBeforeEdit,
  editTaskId,
  noteEditStep,
  openEditTask,
  settleEditTask,
  type EditTaskHandle,
} from "@/lib/builder/edit-task";
import {
  advance as advanceJob,
  failJob,
  recordStep,
  startJob,
} from "@/lib/jobs/store";
import { BuilderError, startBuild, type BuildResult } from "@/lib/n8n";
import { restoreImages, stashImages } from "@/lib/page-html";
import { autofix } from "@/lib/builder/qa/autofix";
import { responsiveBrief } from "@/lib/builder/qa/responsive";
import { validatePage } from "@/lib/builder/validate";
import { describeVerification, repairBrief, verifyEdit } from "@/lib/builder/verify-edit";
import { SITE_URL } from "@/lib/site";
import { inboxBrief } from "@/lib/forms/inbox";
import { chargeCredits, currentBalance } from "@/lib/credits-server";
import { reviewEligibility } from "@/lib/builder/review-round";
import { recordAndConfirm, recordMessage } from "@/lib/thread-server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseServiceClient } from "@/lib/supabase-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type BuildRequestBody = {
  projectId?: unknown;
  prompt?: unknown;
  requestId?: unknown;
  review?: unknown;
  intentOverride?: unknown;
  planOnly?: unknown;
  confirmNewProject?: unknown;
  upgrade?: unknown;
  sql?: unknown;
  confirmSql?: unknown;
  stack?: unknown;
  buildKind?: unknown;
  target?: unknown;
  architecture?: unknown;
  market?: unknown;
  attachmentIds?: unknown;
  model?: unknown;
};

const MAX_PROMPT = 600_000;

type StreamLine =
  | { type: "step"; step: BuildStep }
  | { type: "text"; delta: string }
  | { type: "result"; status: number; body: unknown };

export async function POST(request: Request) {
  servedLog.enterWith({ fallbacks: [] });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (line: StreamLine) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        } catch {
          open = false;
        }
      };

      const task: EditTaskHandle = {};

      let response: NextResponse;
      try {
        response = await handle(
          request,
          (step) => write({ type: "step", step }),
          (delta) => write({ type: "text", delta }),
          task,
        );
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("build: the request failed outright:", error);
        response = NextResponse.json(
          { error: "Something went wrong on my side. Try that again." },
          { status: 500 },
        );
      }

      const body = await response.json().catch(() => null);

      await settleEditTask(task, {
        status: response.status,
        error: (body as { error?: string } | null)?.error ?? null,
      });

      write({ type: "result", status: response.status, body });

      if (open) controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

type TextSink = (delta: string) => void;

async function handle(
  request: Request,
  emit: StepSink,
  emitText: TextSink,
  task: EditTaskHandle,
): Promise<NextResponse> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json(
      { error: "I can't build anything yet — this workspace has no Supabase configured." },
      { status: 503 },
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "You'll need to sign in before I can build." }, { status: 401 });
  }

  const steps = stepRecorder((step) => {
    emit(step);
    if (task.job) {
      void noteEditStep(task.service ?? null, task.job, {
        id: step.id,
        label: step.label,
        detail: step.detail,
        state: step.state,
      });
    }
  });

  let body: BuildRequestBody;
  try {
    body = (await request.json()) as BuildRequestBody;
  } catch {
    return NextResponse.json({ error: "That message didn't arrive in a form I could read. Try sending it again." }, { status: 400 });
  }

  const typed = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const attached = Array.isArray(body.attachmentIds)
    ? body.attachmentIds.filter((id) => typeof id === "string").length
    : 0;
  const prompt = typed || (attached > 0 ? "Use the attached file in this page." : "");

  if (!prompt) {
    return NextResponse.json({ error: "Tell me what you'd like and I'll get started." }, { status: 400 });
  }

  if (prompt.length > MAX_PROMPT) {
    return NextResponse.json(
      { error: `Your brief is too long (${prompt.length.toLocaleString()} characters; the ceiling is ${MAX_PROMPT.toLocaleString()}). Shorten it and try again.` },
      { status: 400 },
    );
  }

  // Emit an initial step to show activity in the frontend timeline
  steps.begin("dispatch-webhook", "Dispatching build request to workflow engine...", "running");

  try {
    // ── ASYNCHRONOUS HANDOFF TO n8n PRODUCTION WEBHOOK ──────────────────────
    const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL || "https://neuvat7.app.n8n.cloud/webhook/api/v1/build";
    const n8nAuthSecret = process.env.N8N_API_KEY || process.env.N8N_HEADER_AUTH_SECRET || "";

    const n8nResponse = await fetch(n8nWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": n8nAuthSecret,
      },
      body: JSON.stringify({
        ...body,
        userId: user.id,
      }),
    });

    if (!n8nResponse.ok) {
      throw new Error(`n8n webhook responded with status code: ${n8nResponse.status}`);
    }

    const n8nData = await n8nResponse.json().catch(() => ({ success: true }));

    steps.complete("dispatch-webhook", "Build workflow successfully triggered.");

    return NextResponse.json({
      success: true,
      message: "Build initiated successfully.",
      data: n8nData,
    });
  } catch (err) {
    steps.fail("dispatch-webhook", "Failed to dispatch build request.");
    // Fallback error response handled gracefully without dropping the socket connection
    return NextResponse.json(
      { error: "Failed to communicate with the build automation pipeline. Please try again." },
      { status: 502 },
    );
  }
}
