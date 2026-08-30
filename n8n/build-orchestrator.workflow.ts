import {
  workflow,
  node,
  trigger,
  sticky,
  placeholder,
  newCredential,
  merge,
  languageModel,
  expr,
} from '@n8n/workflow-sdk';

const buildWebhook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'Build Request Webhook',
    position: [-1120, 380],
    parameters: {
      httpMethod: 'POST',
      path: 'api/v1/build',
      responseMode: 'responseNode',
      options: { allowedOrigins: '*' },
    },
  },
  output: [
    {
      body: {
        requestId: 'req_01HZY',
        userId: '5e9f1a2c-1111-4c3a-9c11-8f2b6d4a7e10',
        projectId: '',
        projectName: 'Aurora Storefront',
        prompt: 'Build me a storefront that sells handmade ceramics with checkout and inventory.',
      },
      headers: { 'content-type': 'application/json' },
      query: {},
    },
  ],
});

const normalizeRequest = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Normalize Build Request',
    position: [-900, 380],
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          {
            id: 'request-id',
            name: 'requestId',
            type: 'string',
            value: expr('{{ $json.body?.requestId ?? $json.requestId ?? $execution.id }}'),
          },
          {
            id: 'user-id',
            name: 'userId',
            type: 'string',
            value: expr('{{ $json.body?.userId ?? $json.userId ?? "" }}'),
          },
          {
            id: 'project-id',
            name: 'projectId',
            type: 'string',
            value: expr('{{ $json.body?.projectId ?? $json.projectId ?? "" }}'),
          },
          {
            id: 'project-name',
            name: 'projectName',
            type: 'string',
            value: expr('{{ $json.body?.projectName ?? $json.projectName ?? "Untitled Build" }}'),
          },
          {
            id: 'prompt',
            name: 'prompt',
            type: 'string',
            value: expr('{{ $json.body?.prompt ?? $json.prompt ?? $json.body?.message ?? $json.message ?? "" }}'),
          },
          {
            id: 'requested-at',
            name: 'requestedAt',
            type: 'string',
            value: expr('{{ $now.toISO() }}'),
          },
        ],
      },
    },
  },
  output: [
    {
      requestId: 'req_01HZY',
      userId: '5e9f1a2c-1111-4c3a-9c11-8f2b6d4a7e10',
      projectId: '',
      projectName: 'Aurora Storefront',
      prompt: 'Build me a storefront that sells handmade ceramics with checkout and inventory.',
      requestedAt: '2026-08-30T09:15:00.000Z',
    },
  ],
});

const classifierModel = languageModel({
  type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
  version: 1.3,
  config: {
    name: 'Intent Classifier Model',
    position: [-700, 640],
    parameters: {
      model: { __rl: true, mode: 'list', value: 'gpt-5-mini' },
      options: { temperature: 0, reasoningEffort: 'low' },
    },
    credentials: { openAiApi: newCredential('OpenAI') },
  },
});

const intentClassifier = node({
  type: '@n8n/n8n-nodes-langchain.textClassifier',
  version: 1.1,
  config: {
    name: 'Intent Classifier',
    position: [-680, 380],
    parameters: {
      inputText: expr('{{ $json.prompt }}'),
      categories: {
        categories: [
          {
            category: 'webapp',
            description:
              'A web application, SaaS product, internal tool, dashboard, or marketing landing page built from scratch. Examples: "a task manager with team accounts", "a landing page for my agency", "a dashboard showing my sales numbers".',
          },
          {
            category: 'wordpress',
            description:
              'A blog, magazine, publication, or content/CMS-driven site, or anything that explicitly mentions WordPress, WooCommerce-free blogging, themes, or plugins. Examples: "a blog about hiking", "migrate my WordPress site to a custom theme".',
          },
          {
            category: 'ecommerce',
            description:
              'An online store that sells products: catalogue, cart, checkout, payments, inventory, or anything that mentions Shopify. Examples: "a store selling handmade ceramics", "a Shopify shop with subscriptions".',
          },
        ],
      },
      options: { multiClass: false, fallback: 'other' },
    },
    subnodes: { model: classifierModel },
  },
  output: [
    {
      requestId: 'req_01HZY',
      projectName: 'Aurora Storefront',
      prompt: 'Build me a storefront that sells handmade ceramics with checkout and inventory.',
    },
  ],
});

const webappSpec = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'WebApp Build Spec',
    position: [-400, -20],
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          { id: 'intent', name: 'intent', type: 'string', value: 'webapp' },
          { id: 'stack', name: 'stack', type: 'string', value: 'nextjs-app-router' },
          {
            id: 'spec',
            name: 'spec',
            type: 'object',
            value: expr(
              '{{ { "framework": "Next.js 15 (App Router)", "styling": "Tailwind CSS", "database": "Supabase", "auth": "Supabase SSR", "features": ["responsive marketing pages", "authenticated dashboard", "row level security"] } }}',
            ),
          },
        ],
      },
    },
  },
  output: [
    {
      requestId: 'req_01HZY',
      projectName: 'Aurora Dashboard',
      prompt: 'Build me a dashboard showing my sales numbers.',
      intent: 'webapp',
      stack: 'nextjs-app-router',
      spec: { framework: 'Next.js 15 (App Router)', styling: 'Tailwind CSS' },
    },
  ],
});

const scaffoldNextApp = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Scaffold Next.js App',
    position: [-160, -20],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: placeholder('Builder service endpoint that scaffolds a Next.js app, e.g. https://builder.quickstark.tech/v1/webapp/scaffold'),
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr(
        '{{ JSON.stringify({ requestId: $json.requestId, projectName: $json.projectName, prompt: $json.prompt, stack: $json.stack, spec: $json.spec }) }}',
      ),
      options: {},
    },
  },
  output: [
    {
      previewUrl: 'https://aurora-dashboard.preview.quickstark.tech',
      repoUrl: 'https://github.com/quickstark/aurora-dashboard',
      files: 42,
      error: null,
    },
  ],
});

const applySupabaseSchema = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Apply Supabase Schema',
    position: [80, -20],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: placeholder('Endpoint that applies the generated Supabase schema, e.g. https://builder.quickstark.tech/v1/supabase/schema'),
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr(
        '{{ JSON.stringify({ requestId: $("Normalize Build Request").item.json.requestId, projectName: $("Normalize Build Request").item.json.projectName, intent: "webapp" }) }}',
      ),
      options: {},
    },
  },
  output: [
    {
      schemaApplied: true,
      projectUrl: 'https://xyz.supabase.co',
      tables: ['user_profiles', 'projects'],
      anonKey: 'sb_publishable_xxx',
    },
  ],
});

const collectWebappResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Collect WebApp Result',
    position: [320, -20],
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'intent', name: 'intent', type: 'string', value: 'webapp' },
          {
            id: 'preview-url',
            name: 'previewUrl',
            type: 'string',
            value: expr('{{ $("Scaffold Next.js App").item.json.previewUrl ?? "" }}'),
          },
          {
            id: 'repo-url',
            name: 'repoUrl',
            type: 'string',
            value: expr('{{ $("Scaffold Next.js App").item.json.repoUrl ?? "" }}'),
          },
          {
            id: 'admin-url',
            name: 'adminUrl',
            type: 'string',
            value: '',
          },
          {
            id: 'config-keys',
            name: 'configKeys',
            type: 'object',
            value: expr(
              '{{ { "NEXT_PUBLIC_SUPABASE_URL": $("Apply Supabase Schema").item.json.projectUrl ?? "", "NEXT_PUBLIC_SUPABASE_ANON_KEY": $("Apply Supabase Schema").item.json.anonKey ?? "" } }}',
            ),
          },
          {
            id: 'artifacts',
            name: 'artifacts',
            type: 'object',
            value: expr(
              '{{ { "stack": "Next.js App Router + Tailwind CSS + Supabase", "schemaApplied": $("Apply Supabase Schema").item.json.schemaApplied ?? false, "tables": $("Apply Supabase Schema").item.json.tables ?? [] } }}',
            ),
          },
          {
            id: 'branch-status',
            name: 'branchStatus',
            type: 'string',
            value: expr('{{ $("Scaffold Next.js App").item.json.error ? "failed" : "provisioned" }}'),
          },
        ],
      },
    },
  },
  output: [
    {
      intent: 'webapp',
      previewUrl: 'https://aurora-dashboard.preview.quickstark.tech',
      repoUrl: 'https://github.com/quickstark/aurora-dashboard',
      adminUrl: '',
      configKeys: { NEXT_PUBLIC_SUPABASE_URL: 'https://xyz.supabase.co' },
      artifacts: { stack: 'Next.js App Router + Tailwind CSS + Supabase' },
      branchStatus: 'provisioned',
    },
  ],
});

const wordpressSpec = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'WordPress Build Spec',
    position: [-400, 240],
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          { id: 'intent', name: 'intent', type: 'string', value: 'wordpress' },
          { id: 'stack', name: 'stack', type: 'string', value: 'wordpress-headless' },
          {
            id: 'spec',
            name: 'spec',
            type: 'object',
            value: expr(
              '{{ { "delivery": "Headless WordPress via REST API / WPGraphQL", "theme": "Custom block theme", "plugins": ["wp-graphql", "yoast-seo", "wp-super-cache"], "features": ["editorial workflow", "SEO defaults", "media library"] } }}',
            ),
          },
        ],
      },
    },
  },
  output: [
    {
      requestId: 'req_01HZY',
      projectName: 'Trailhead Journal',
      prompt: 'Build me a blog about hiking trails.',
      intent: 'wordpress',
      stack: 'wordpress-headless',
      spec: { delivery: 'Headless WordPress via REST API / WPGraphQL' },
    },
  ],
});

const provisionWordpress = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Provision WordPress Site',
    position: [-160, 240],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: placeholder('Endpoint that provisions the WordPress instance and installs plugins, e.g. https://builder.quickstark.tech/v1/wordpress/provision'),
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr(
        '{{ JSON.stringify({ requestId: $json.requestId, projectName: $json.projectName, prompt: $json.prompt, spec: $json.spec }) }}',
      ),
      options: {},
    },
  },
  output: [
    {
      siteUrl: 'https://trailhead-journal.preview.quickstark.tech',
      adminUrl: 'https://trailhead-journal.preview.quickstark.tech/wp-admin',
      restApiUrl: 'https://trailhead-journal.preview.quickstark.tech/wp-json/wp/v2',
      graphqlUrl: 'https://trailhead-journal.preview.quickstark.tech/graphql',
      themeRepoUrl: 'https://github.com/quickstark/trailhead-theme',
      pluginsInstalled: ['wp-graphql', 'yoast-seo'],
      error: null,
    },
  ],
});

const createStarterPage = node({
  type: 'n8n-nodes-base.wordpress',
  version: 1,
  config: {
    name: 'Create Starter Page',
    position: [80, 240],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'page',
      operation: 'create',
      authType: 'basicAuth',
      title: expr('{{ $("Normalize Build Request").item.json.projectName }}'),
      additionalFields: {
        status: 'draft',
        content: expr('{{ $("Normalize Build Request").item.json.prompt }}'),
      },
    },
    credentials: { wordpressApi: newCredential('WordPress') },
  },
  output: [
    {
      id: 12,
      link: 'https://trailhead-journal.preview.quickstark.tech/?page_id=12',
      status: 'draft',
    },
  ],
});

const collectWordpressResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Collect WordPress Result',
    position: [320, 240],
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'intent', name: 'intent', type: 'string', value: 'wordpress' },
          {
            id: 'preview-url',
            name: 'previewUrl',
            type: 'string',
            value: expr('{{ $("Provision WordPress Site").item.json.siteUrl ?? "" }}'),
          },
          { id: 'repo-url', name: 'repoUrl', type: 'string', value: expr('{{ $("Provision WordPress Site").item.json.themeRepoUrl ?? "" }}') },
          {
            id: 'admin-url',
            name: 'adminUrl',
            type: 'string',
            value: expr('{{ $("Provision WordPress Site").item.json.adminUrl ?? "" }}'),
          },
          {
            id: 'config-keys',
            name: 'configKeys',
            type: 'object',
            value: expr(
              '{{ { "WORDPRESS_API_URL": $("Provision WordPress Site").item.json.restApiUrl ?? "", "WPGRAPHQL_URL": $("Provision WordPress Site").item.json.graphqlUrl ?? "" } }}',
            ),
          },
          {
            id: 'artifacts',
            name: 'artifacts',
            type: 'object',
            value: expr(
              '{{ { "stack": "Headless WordPress + custom theme", "plugins": $("Provision WordPress Site").item.json.pluginsInstalled ?? [], "starterPageUrl": $("Create Starter Page").item.json.link ?? "" } }}',
            ),
          },
          {
            id: 'branch-status',
            name: 'branchStatus',
            type: 'string',
            value: expr('{{ $("Provision WordPress Site").item.json.error ? "failed" : "provisioned" }}'),
          },
        ],
      },
    },
  },
  output: [
    {
      intent: 'wordpress',
      previewUrl: 'https://trailhead-journal.preview.quickstark.tech',
      repoUrl: 'https://github.com/quickstark/trailhead-theme',
      adminUrl: 'https://trailhead-journal.preview.quickstark.tech/wp-admin',
      configKeys: { WORDPRESS_API_URL: 'https://trailhead-journal.preview.quickstark.tech/wp-json/wp/v2' },
      artifacts: { stack: 'Headless WordPress + custom theme' },
      branchStatus: 'provisioned',
    },
  ],
});

const commerceSpec = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'E-Commerce Build Spec',
    position: [-400, 500],
    parameters: {
      mode: 'manual',
      includeOtherFields: true,
      assignments: {
        assignments: [
          { id: 'intent', name: 'intent', type: 'string', value: 'ecommerce' },
          { id: 'stack', name: 'stack', type: 'string', value: 'shopify-supabase' },
          {
            id: 'spec',
            name: 'spec',
            type: 'object',
            value: expr(
              '{{ { "commerce": "Shopify Admin API", "identity": "Supabase Auth & DB", "features": ["product catalogue", "cart and checkout", "inventory sync", "order webhooks"] } }}',
            ),
          },
        ],
      },
    },
  },
  output: [
    {
      requestId: 'req_01HZY',
      projectName: 'Aurora Storefront',
      prompt: 'Build me a storefront that sells handmade ceramics with checkout and inventory.',
      intent: 'ecommerce',
      stack: 'shopify-supabase',
      spec: { commerce: 'Shopify Admin API' },
    },
  ],
});

const seedShopifyCatalog = node({
  type: 'n8n-nodes-base.shopify',
  version: 1,
  config: {
    name: 'Seed Shopify Catalog',
    position: [-160, 500],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'product',
      operation: 'create',
      authentication: 'accessToken',
      title: expr('{{ $json.projectName }} — Sample Product'),
      additionalFields: {
        body_html: expr('{{ $json.prompt }}'),
        product_type: 'Sample',
        tags: 'quickstark-ai,scaffold',
        published_scope: 'web',
      },
    },
    credentials: { shopifyAccessTokenApi: newCredential('Shopify Admin API') },
  },
  output: [
    {
      id: 8899001122,
      title: 'Aurora Storefront — Sample Product',
      handle: 'aurora-storefront-sample-product',
      status: 'active',
    },
  ],
});

const registerStoreWebhooks = node({
  type: 'n8n-nodes-base.httpRequest',
  version: 4.5,
  config: {
    name: 'Register Store Webhooks',
    position: [80, 500],
    onError: 'continueRegularOutput',
    parameters: {
      method: 'POST',
      url: placeholder('Endpoint that registers Shopify order/inventory webhooks and provisions Supabase auth, e.g. https://builder.quickstark.tech/v1/commerce/provision'),
      sendBody: true,
      specifyBody: 'json',
      jsonBody: expr(
        '{{ JSON.stringify({ requestId: $("Normalize Build Request").item.json.requestId, projectName: $("Normalize Build Request").item.json.projectName, seedProductId: $json.id ?? null, topics: ["orders/create", "products/update", "inventory_levels/update"] }) }}',
      ),
      options: {},
    },
  },
  output: [
    {
      storefrontUrl: 'https://aurora-storefront.preview.quickstark.tech',
      adminUrl: 'https://admin.shopify.com/store/aurora-storefront',
      storeDomain: 'aurora-storefront.myshopify.com',
      repoUrl: 'https://github.com/quickstark/aurora-storefront',
      webhooksRegistered: ['orders/create', 'products/update'],
      supabaseUrl: 'https://xyz.supabase.co',
      supabaseAnonKey: 'sb_publishable_xxx',
      error: null,
    },
  ],
});

const collectCommerceResult = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Collect E-Commerce Result',
    position: [320, 500],
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'intent', name: 'intent', type: 'string', value: 'ecommerce' },
          {
            id: 'preview-url',
            name: 'previewUrl',
            type: 'string',
            value: expr('{{ $("Register Store Webhooks").item.json.storefrontUrl ?? "" }}'),
          },
          { id: 'repo-url', name: 'repoUrl', type: 'string', value: expr('{{ $("Register Store Webhooks").item.json.repoUrl ?? "" }}') },
          {
            id: 'admin-url',
            name: 'adminUrl',
            type: 'string',
            value: expr('{{ $("Register Store Webhooks").item.json.adminUrl ?? "" }}'),
          },
          {
            id: 'config-keys',
            name: 'configKeys',
            type: 'object',
            value: expr(
              '{{ { "NEXT_PUBLIC_SUPABASE_URL": $("Register Store Webhooks").item.json.supabaseUrl ?? "", "NEXT_PUBLIC_SUPABASE_ANON_KEY": $("Register Store Webhooks").item.json.supabaseAnonKey ?? "", "SHOPIFY_STORE_DOMAIN": $("Register Store Webhooks").item.json.storeDomain ?? "" } }}',
            ),
          },
          {
            id: 'artifacts',
            name: 'artifacts',
            type: 'object',
            value: expr(
              '{{ { "stack": "Shopify Admin API + Supabase Auth & DB", "seedProductId": $("Seed Shopify Catalog").item.json.id ?? null, "webhooks": $("Register Store Webhooks").item.json.webhooksRegistered ?? [] } }}',
            ),
          },
          {
            id: 'branch-status',
            name: 'branchStatus',
            type: 'string',
            value: expr('{{ $("Register Store Webhooks").item.json.error ? "failed" : "provisioned" }}'),
          },
        ],
      },
    },
  },
  output: [
    {
      intent: 'ecommerce',
      previewUrl: 'https://aurora-storefront.preview.quickstark.tech',
      repoUrl: 'https://github.com/quickstark/aurora-storefront',
      adminUrl: 'https://admin.shopify.com/store/aurora-storefront',
      configKeys: { NEXT_PUBLIC_SUPABASE_URL: 'https://xyz.supabase.co' },
      artifacts: { stack: 'Shopify Admin API + Supabase Auth & DB' },
      branchStatus: 'provisioned',
    },
  ],
});

const flagForManualReview = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Flag For Manual Review',
    position: [320, 760],
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'intent', name: 'intent', type: 'string', value: 'unclassified' },
          { id: 'preview-url', name: 'previewUrl', type: 'string', value: '' },
          { id: 'repo-url', name: 'repoUrl', type: 'string', value: '' },
          { id: 'admin-url', name: 'adminUrl', type: 'string', value: '' },
          { id: 'config-keys', name: 'configKeys', type: 'object', value: expr('{{ {} }}') },
          {
            id: 'artifacts',
            name: 'artifacts',
            type: 'object',
            value: expr(
              '{{ { "reason": "The prompt did not clearly match a web app, WordPress site or e-commerce build.", "prompt": $("Normalize Build Request").item.json.prompt } }}',
            ),
          },
          { id: 'branch-status', name: 'branchStatus', type: 'string', value: 'needs_clarification' },
        ],
      },
    },
  },
  output: [
    {
      intent: 'unclassified',
      previewUrl: '',
      repoUrl: '',
      adminUrl: '',
      configKeys: {},
      artifacts: { reason: 'The prompt did not clearly match a web app, WordPress site or e-commerce build.' },
      branchStatus: 'needs_clarification',
    },
  ],
});

const collectBuildOutcome = merge({
  version: 3.2,
  config: {
    name: 'Collect Build Outcome',
    position: [580, 380],
    parameters: { mode: 'append', numberInputs: 4 },
  },
});

const assembleBuildResult = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'Assemble Build Result',
    position: [800, 380],
    parameters: {
      mode: 'runOnceForAllItems',
      jsCode:
        'const request = $("Normalize Build Request").first().json;\n' +
        'const branch = $input.first().json;\n' +
        'const failed = branch.branchStatus === "failed";\n' +
        'const needsClarification = branch.branchStatus === "needs_clarification";\n' +
        'const status = failed ? "Failed" : needsClarification ? "Needs Clarification" : "Building";\n' +
        'return [{\n' +
        '  json: {\n' +
        '    requestId: request.requestId,\n' +
        '    userId: request.userId,\n' +
        '    projectId: request.projectId,\n' +
        '    projectName: request.projectName,\n' +
        '    prompt: request.prompt,\n' +
        '    intent: branch.intent,\n' +
        '    status,\n' +
        '    previewUrl: branch.previewUrl || "",\n' +
        '    repoUrl: branch.repoUrl || "",\n' +
        '    adminUrl: branch.adminUrl || "",\n' +
        '    configKeys: branch.configKeys || {},\n' +
        '    artifacts: branch.artifacts || {},\n' +
        '    requestedAt: request.requestedAt,\n' +
        '    completedAt: new Date().toISOString(),\n' +
        '  },\n' +
        '}];',
    },
  },
  output: [
    {
      requestId: 'req_01HZY',
      userId: '5e9f1a2c-1111-4c3a-9c11-8f2b6d4a7e10',
      projectId: '',
      projectName: 'Aurora Storefront',
      prompt: 'Build me a storefront that sells handmade ceramics with checkout and inventory.',
      intent: 'ecommerce',
      status: 'Building',
      previewUrl: 'https://aurora-storefront.preview.quickstark.tech',
      repoUrl: 'https://github.com/quickstark/aurora-storefront',
      adminUrl: 'https://admin.shopify.com/store/aurora-storefront',
      configKeys: { NEXT_PUBLIC_SUPABASE_URL: 'https://xyz.supabase.co' },
      artifacts: { stack: 'Shopify Admin API + Supabase Auth & DB' },
      requestedAt: '2026-08-30T09:15:00.000Z',
      completedAt: '2026-08-30T09:16:12.000Z',
    },
  ],
});

const syncProjectRow = node({
  type: 'n8n-nodes-base.supabase',
  version: 1,
  config: {
    name: 'Sync Project Row',
    position: [1020, 380],
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'row',
      operation: 'update',
      tableId: 'projects',
      filterType: 'manual',
      matchType: 'allFilters',
      filters: {
        conditions: [
          { keyName: 'id', condition: 'eq', keyValue: expr('{{ $json.projectId }}') },
        ],
      },
      dataToSend: 'defineBelow',
      fieldsUi: {
        fieldValues: [
          { fieldId: 'status', fieldValue: expr('{{ $json.status }}') },
          { fieldId: 'intent', fieldValue: expr('{{ $json.intent }}') },
          { fieldId: 'preview_url', fieldValue: expr('{{ $json.previewUrl }}') },
          { fieldId: 'repo_url', fieldValue: expr('{{ $json.repoUrl }}') },
          { fieldId: 'admin_url', fieldValue: expr('{{ $json.adminUrl }}') },
          { fieldId: 'last_build_at', fieldValue: expr('{{ $json.completedAt }}') },
        ],
      },
    },
    credentials: { supabaseApi: newCredential('Supabase QuickStark.Ai') },
  },
  output: [
    {
      id: 'b2b1c0d9-2222-4a55-9f10-3c7de1a48b21',
      user_id: '5e9f1a2c-1111-4c3a-9c11-8f2b6d4a7e10',
      name: 'Aurora Storefront',
      status: 'Building',
      created_at: '2026-08-30T09:16:12.000Z',
    },
  ],
});

const buildChatPayload = node({
  type: 'n8n-nodes-base.set',
  version: 3.4,
  config: {
    name: 'Build Chat Payload',
    position: [1240, 380],
    parameters: {
      mode: 'manual',
      includeOtherFields: false,
      assignments: {
        assignments: [
          { id: 'ok', name: 'ok', type: 'boolean', value: expr('{{ $("Assemble Build Result").item.json.status !== "Failed" }}') },
          { id: 'request-id', name: 'requestId', type: 'string', value: expr('{{ $("Assemble Build Result").item.json.requestId }}') },
          {
            id: 'project-id',
            name: 'projectId',
            type: 'string',
            value: expr('{{ $("Assemble Build Result").item.json.projectId }}'),
          },
          { id: 'intent', name: 'intent', type: 'string', value: expr('{{ $("Assemble Build Result").item.json.intent }}') },
          { id: 'status', name: 'status', type: 'string', value: expr('{{ $("Assemble Build Result").item.json.status }}') },
          {
            id: 'links',
            name: 'links',
            type: 'object',
            value: expr(
              '{{ { "preview": $("Assemble Build Result").item.json.previewUrl, "repo": $("Assemble Build Result").item.json.repoUrl, "admin": $("Assemble Build Result").item.json.adminUrl } }}',
            ),
          },
          { id: 'config-keys', name: 'configKeys', type: 'object', value: expr('{{ $("Assemble Build Result").item.json.configKeys }}') },
          { id: 'artifacts', name: 'artifacts', type: 'object', value: expr('{{ $("Assemble Build Result").item.json.artifacts }}') },
          {
            id: 'message',
            name: 'message',
            type: 'string',
            value: expr(
              '{{ $("Assemble Build Result").item.json.status === "Needs Clarification" ? "I could not tell whether you want a web app, a WordPress site or a store. Could you say a little more about what you are building?" : "Your " + $("Assemble Build Result").item.json.intent + " build is underway - the preview link updates as it finishes." }}',
            ),
          },
        ],
      },
    },
  },
  output: [
    {
      ok: true,
      requestId: 'req_01HZY',
      projectId: 'b2b1c0d9-2222-4a55-9f10-3c7de1a48b21',
      intent: 'ecommerce',
      status: 'Building',
      links: { preview: 'https://aurora-storefront.preview.quickstark.tech', repo: '', admin: '' },
      configKeys: { NEXT_PUBLIC_SUPABASE_URL: 'https://xyz.supabase.co' },
      artifacts: { stack: 'Shopify Admin API + Supabase Auth & DB' },
      message: 'Your ecommerce build is underway - the preview link updates as it finishes.',
    },
  ],
});

const respondToChatUi = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'Return Payload to Chat UI',
    position: [1460, 380],
    parameters: {
      respondWith: 'firstIncomingItem',
      options: { responseCode: 200 },
    },
  },
});

const entryNote = sticky(
  '## 1 - Chat UI entry point\n\nThe QuickStark.Ai chat POSTs to /webhook/api/v1/build with { prompt, projectName, userId, projectId?, requestId? }. The Set node normalizes both body.* and top-level shapes so browser calls and test runs behave the same.',
  [buildWebhook, normalizeRequest],
  { color: 4 },
);

const classifierNote = sticky(
  '## 2 - Intent classifier\n\nThe Text Classifier is the routing switch: one output per build type plus an "other" fallback so nothing is dropped silently. Temperature is 0 for stable routing.',
  [intentClassifier, classifierModel],
  { color: 3 },
);

const branchNote = sticky(
  '## 3 - Build branches\n\nEach branch writes its spec, calls the provisioning services, then normalizes to the same shape: intent, previewUrl, repoUrl, adminUrl, configKeys, artifacts, branchStatus. Fill in the placeholder URLs and connect the WordPress / Shopify / Supabase credentials.',
  [webappSpec, collectCommerceResult],
  { color: 5 },
);

const syncNote = sticky(
  '## 4 - Status sync and response\n\nBranches fan into one Merge, get assembled into a single result, are written to the projects table in Supabase, and come back to the chat UI as preview links, config keys and artifacts.',
  [collectBuildOutcome, respondToChatUi],
  { color: 6 },
);

export default workflow('quickstark-build-orchestrator', 'QuickStark.Ai - Build Orchestrator')
  .add(buildWebhook)
  .to(normalizeRequest)
  .to(intentClassifier)
  .add(
    intentClassifier
      .output(0)
      .to(webappSpec.to(scaffoldNextApp.to(applySupabaseSchema.to(collectWebappResult.to(collectBuildOutcome.input(0)))))),
  )
  .add(
    intentClassifier
      .output(1)
      .to(wordpressSpec.to(provisionWordpress.to(createStarterPage.to(collectWordpressResult.to(collectBuildOutcome.input(1)))))),
  )
  .add(
    intentClassifier
      .output(2)
      .to(commerceSpec.to(seedShopifyCatalog.to(registerStoreWebhooks.to(collectCommerceResult.to(collectBuildOutcome.input(2)))))),
  )
  .add(intentClassifier.output(3).to(flagForManualReview.to(collectBuildOutcome.input(3))))
  .add(collectBuildOutcome)
  .to(assembleBuildResult)
  .to(syncProjectRow)
  .to(buildChatPayload)
  .to(respondToChatUi)
  .add(entryNote)
  .add(classifierNote)
  .add(branchNote)
  .add(syncNote);
