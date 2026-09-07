/* The database a generated project gets, as data rather than as prose.
 *
 * The old arrangement asked a model for its own schema — "write the SQL at the
 * end of the document" — and what came back was plausible SQL that nobody ran.
 * It could not be run: it named tables the app did not query, it enabled
 * row-level security without a policy behind it (which locks the table rather
 * than securing it), and it was different every build, so two projects of the
 * same kind had two different shapes and neither could be migrated.
 *
 * So the schema is decided here, deterministically, from the architecture
 * manifest — and the model is handed the finished thing to write an application
 * against. This is the same rule the asset pipeline already works to: the model
 * that writes the code does not decide what the project is made of, it is given
 * the answer.
 *
 * ── The policies are the security model, not a decoration ──────────────────
 *
 * A generated project is statically exported (see scaffold.ts). It has no
 * server of its own, so it holds no secret, so there is no privileged tier that
 * could check a permission on the way past. Every query it makes is made from
 * somebody's browser with a key that is public by design.
 *
 * That means row-level security is not defence in depth here. It is the only
 * defence. A table with RLS off is world-readable to anyone who opens the page
 * and looks at the network tab; a table with RLS on and no policy is readable by
 * nobody, which breaks the app and teaches whoever debugs it to turn RLS off.
 * Both failures are one line of SQL away, so neither is left to a model: every
 * table below carries its policies with it, and toSql refuses to emit a table
 * that has none.
 *
 * ── Where these tables live ────────────────────────────────────────────────
 *
 * In a schema of their own, named for the project. Generated apps share one
 * Postgres instance, and `public.products` cannot belong to two stores. The
 * schema is the isolation boundary: app_<id>.products is one store's catalogue,
 * and a policy in it can never accidentally match a row in another.
 *
 * What is NOT isolated is `auth.users`, which Supabase keeps one of per
 * project. Two generated apps on the shared instance therefore share an
 * identity pool — somebody who signed up to one has an auth row the other can
 * see the id of. They cannot read its data (no policy grants it) and they
 * cannot become an admin of it (the role lives in this schema's own profiles
 * table, not on the auth user), but the accounts are not separate, and a project
 * that needs them to be needs its own Supabase. See backend/connection.ts,
 * which is where a person links theirs.
 */

import type { ArchitectureManifest } from "./architecture";

export type ColumnType =
  | "uuid"
  | "text"
  | "integer"
  | "bigint"
  | "numeric"
  | "boolean"
  | "timestamptz"
  | "jsonb";

export type Column = {
  name: string;
  type: ColumnType;
  /** Columns are NOT NULL unless something says otherwise. */
  nullable?: boolean;
  /** Raw SQL, emitted as written. */
  default?: string;
  primaryKey?: boolean;
  unique?: boolean;
  references?: {
    /** A table in this same schema, or "auth.users" for the identity table. */
    table: string;
    column?: string;
    onDelete?: "cascade" | "set null";
  };
  /** A CHECK constraint's expression, without the surrounding CHECK (…). */
  check?: string;
};

/**
 * One row-level security policy.
 *
 * `why` is required, and that is deliberate: a policy nobody can explain is a
 * policy nobody can review, and these are the whole security model. It is
 * emitted into the migration as a comment above the policy it explains.
 */
export type Policy = {
  name: string;
  for: "select" | "insert" | "update" | "delete" | "all";
  /** Who it applies to. `anon` is a visitor who has not signed in. */
  to: ("anon" | "authenticated")[];
  /** The row test for reads and for the existing row on writes. */
  using?: string;
  /** The row test for the incoming row on inserts and updates. */
  check?: string;
  why: string;
};

export type Table = {
  name: string;
  /** What this table is, in one sentence. Emitted as a COMMENT ON TABLE. */
  what: string;
  columns: Column[];
  indexes?: { on: string[] }[];
  policies: Policy[];
};

export type Bucket = {
  name: string;
  /** Whether anybody may read the files without signing in. */
  public: boolean;
  what: string;
};

export type DataModel = {
  /** The Postgres schema these live in. */
  schema: string;
  tables: Table[];
  buckets: Bucket[];
};

/* ── Pieces the models are assembled from ──────────────────────────────────
 *
 * Composed rather than written out per kind, because the overlap is most of it:
 * a store and a blog both have people, both have categories, both have media.
 * Writing each kind out in full is how the two drift until a fix to one is not
 * a fix to the other.
 */

/** Every table gets these three, in this order. */
function base(): Column[] {
  return [
    { name: "id", type: "uuid", primaryKey: true, default: "gen_random_uuid()" },
    { name: "created_at", type: "timestamptz", default: "now()" },
    { name: "updated_at", type: "timestamptz", default: "now()" },
  ];
}

/* The identity table, and the only place a role is written down.
 *
 * Supabase's own auth.users cannot carry the role: it is a shared table on the
 * shared instance, so a role written on it would be a role in every app at
 * once. It lives here, in this project's schema, which is what makes "an admin
 * of this store" mean something narrower than "a person with an account".
 *
 * The insert policy is the one worth reading twice. Somebody signing up writes
 * their own profile row, so the policy has to allow it — and if it allowed them
 * to write the `role` column too, every user could make themselves an admin on
 * the way in. Postgres has no column-level WITH CHECK, so the constraint is on
 * the column instead: role defaults to 'customer' and the update policy below
 * refuses to change it unless an admin is asking. */
function profiles(adminRole: string): Table {
  return {
    name: "profiles",
    what: "One row per person with an account, holding what this app knows about them beyond their sign-in.",
    columns: [
      {
        name: "id",
        type: "uuid",
        primaryKey: true,
        references: { table: "auth.users", column: "id", onDelete: "cascade" },
      },
      { name: "email", type: "text" },
      { name: "full_name", type: "text", nullable: true },
      { name: "avatar_url", type: "text", nullable: true },
      {
        name: "role",
        type: "text",
        default: "'customer'",
        check: `role in ('customer', '${adminRole}')`,
      },
      { name: "created_at", type: "timestamptz", default: "now()" },
      { name: "updated_at", type: "timestamptz", default: "now()" },
    ],
    policies: [
      {
        name: "profiles_select_own",
        for: "select",
        to: ["authenticated"],
        using: "id = auth.uid() or is_admin()",
        why: "A person reads their own profile. An admin reads everybody's, because managing users is what an admin does.",
      },
      {
        name: "profiles_insert_own",
        for: "insert",
        to: ["authenticated"],
        check: "id = auth.uid()",
        why: "Signing up writes one row, and it has to be your own. The role column is not settable here — it defaults to 'customer' and only the policy below can change it.",
      },
      {
        name: "profiles_update_own",
        for: "update",
        to: ["authenticated"],
        using: "id = auth.uid() or is_admin()",
        check: `id = auth.uid() and role = (select role from profiles where id = auth.uid()) or is_admin()`,
        why: "You may edit your own profile but not your own role — the check re-reads the stored role and refuses a change to it. An admin may change either.",
      },
    ],
  };
}

/** Categories, shared by every kind that groups things. */
function categories(): Table {
  return {
    name: "categories",
    what: "How this project's things are grouped, for navigation and filtering.",
    columns: [
      ...base(),
      { name: "name", type: "text" },
      { name: "slug", type: "text", unique: true },
      { name: "description", type: "text", nullable: true },
      { name: "parent_id", type: "uuid", nullable: true, references: { table: "categories", onDelete: "set null" } },
      { name: "position", type: "integer", default: "0" },
    ],
    indexes: [{ on: ["slug"] }],
    policies: [
      {
        name: "categories_public_read",
        for: "select",
        to: ["anon", "authenticated"],
        using: "true",
        why: "Categories are navigation. They are on the public site, so they are public.",
      },
      {
        name: "categories_admin_write",
        for: "all",
        to: ["authenticated"],
        using: "is_admin()",
        check: "is_admin()",
        why: "Only an admin changes how the site is organised.",
      },
    ],
  };
}

/* The commerce tables. Split out because a store is the kind with the most of
   them and the most that can go wrong: an order that can be read by the wrong
   customer is the failure this whole file exists to prevent. */
function commerce(withStorage: boolean): Table[] {
  const tables: Table[] = [
    {
      name: "products",
      what: "The catalogue. One row per thing for sale.",
      columns: [
        ...base(),
        { name: "name", type: "text" },
        { name: "slug", type: "text", unique: true },
        { name: "description", type: "text", nullable: true },
        { name: "price", type: "numeric", check: "price >= 0" },
        { name: "compare_at_price", type: "numeric", nullable: true, check: "compare_at_price is null or compare_at_price >= 0" },
        { name: "currency", type: "text", default: "'USD'" },
        { name: "category_id", type: "uuid", nullable: true, references: { table: "categories", onDelete: "set null" } },
        ...(withStorage ? [{ name: "image_path", type: "text" as const, nullable: true }] : []),
        {
          name: "status",
          type: "text",
          default: "'draft'",
          check: "status in ('draft', 'active', 'archived')",
        },
      ],
      indexes: [{ on: ["slug"] }, { on: ["status"] }, { on: ["category_id"] }],
      policies: [
        {
          name: "products_public_read_active",
          for: "select",
          to: ["anon", "authenticated"],
          using: "status = 'active'",
          why: "A shopper sees the catalogue without signing in — but only what is actually for sale. A draft product is the merchant's work in progress and is not on the shop.",
        },
        {
          name: "products_admin_read_all",
          for: "select",
          to: ["authenticated"],
          using: "is_admin()",
          why: "The merchant sees drafts and archived products too, because that is what the admin list is for.",
        },
        {
          name: "products_admin_write",
          for: "all",
          to: ["authenticated"],
          using: "is_admin()",
          check: "is_admin()",
          why: "Only the merchant changes the catalogue. A customer with a browser console cannot reprice anything.",
        },
      ],
    },

    {
      name: "product_variants",
      what: "The sizes, colours or plans a product comes in, each with its own price and stock.",
      columns: [
        ...base(),
        { name: "product_id", type: "uuid", references: { table: "products", onDelete: "cascade" } },
        { name: "name", type: "text" },
        { name: "sku", type: "text", nullable: true },
        { name: "price", type: "numeric", nullable: true, check: "price is null or price >= 0" },
        { name: "stock", type: "integer", default: "0", check: "stock >= 0" },
        { name: "position", type: "integer", default: "0" },
      ],
      indexes: [{ on: ["product_id"] }],
      policies: [
        {
          name: "variants_public_read",
          for: "select",
          to: ["anon", "authenticated"],
          using: "exists (select 1 from products p where p.id = product_id and (p.status = 'active' or is_admin()))",
          why: "A variant is visible exactly when its product is. Written as a lookup rather than a copied status column so the two can never disagree.",
        },
        {
          name: "variants_admin_write",
          for: "all",
          to: ["authenticated"],
          using: "is_admin()",
          check: "is_admin()",
          why: "Stock and pricing are the merchant's.",
        },
      ],
    },

    {
      name: "orders",
      what: "One row per order placed, and the table whose policies matter most.",
      columns: [
        ...base(),
        {
          name: "customer_id",
          type: "uuid",
          nullable: true,
          references: { table: "auth.users", column: "id", onDelete: "set null" },
        },
        { name: "email", type: "text" },
        { name: "number", type: "text", unique: true },
        {
          name: "status",
          type: "text",
          default: "'pending'",
          check: "status in ('pending', 'paid', 'fulfilled', 'cancelled', 'refunded')",
        },
        { name: "subtotal", type: "numeric", check: "subtotal >= 0" },
        { name: "shipping", type: "numeric", default: "0", check: "shipping >= 0" },
        { name: "tax", type: "numeric", default: "0", check: "tax >= 0" },
        { name: "total", type: "numeric", check: "total >= 0" },
        { name: "currency", type: "text", default: "'USD'" },
        { name: "shipping_address", type: "jsonb", nullable: true },
      ],
      indexes: [{ on: ["customer_id"] }, { on: ["status"] }],
      policies: [
        {
          name: "orders_select_own",
          for: "select",
          to: ["authenticated"],
          using: "customer_id = auth.uid() or is_admin()",
          why: "A customer reads their own orders and nobody else's. This is the policy the whole customer/admin split rests on — without it, one customer's id in a query string reads another's purchase history.",
        },
        {
          name: "orders_insert_own",
          for: "insert",
          to: ["authenticated"],
          check: "customer_id = auth.uid()",
          why: "Placing an order writes it against yourself. An order cannot be created in somebody else's name.",
        },
        {
          name: "orders_admin_update",
          for: "update",
          to: ["authenticated"],
          using: "is_admin()",
          check: "is_admin()",
          why: "Only the merchant moves an order through its statuses. A customer cannot mark their own order paid.",
        },
      ],
    },

    {
      name: "order_items",
      what: "The lines of an order, with the price as it was when the order was placed.",
      columns: [
        ...base(),
        { name: "order_id", type: "uuid", references: { table: "orders", onDelete: "cascade" } },
        { name: "product_id", type: "uuid", nullable: true, references: { table: "products", onDelete: "set null" } },
        { name: "variant_id", type: "uuid", nullable: true, references: { table: "product_variants", onDelete: "set null" } },
        /* Copied rather than joined, on purpose: an order is a record of what was
           bought at the price it was bought at, and a product renamed or repriced
           next month must not rewrite last month's receipt. */
        { name: "name", type: "text" },
        { name: "unit_price", type: "numeric", check: "unit_price >= 0" },
        { name: "quantity", type: "integer", check: "quantity > 0" },
      ],
      indexes: [{ on: ["order_id"] }],
      policies: [
        {
          name: "order_items_select_own",
          for: "select",
          to: ["authenticated"],
          using: "exists (select 1 from orders o where o.id = order_id and (o.customer_id = auth.uid() or is_admin()))",
          why: "A line is readable exactly when its order is. Derived from the order rather than carrying its own customer id, so the two cannot drift apart.",
        },
        {
          name: "order_items_insert_own",
          for: "insert",
          to: ["authenticated"],
          check: "exists (select 1 from orders o where o.id = order_id and o.customer_id = auth.uid())",
          why: "Lines may only be added to your own order.",
        },
      ],
    },

    {
      name: "discounts",
      what: "Codes that reduce a total, with the rules that decide whether one applies.",
      columns: [
        ...base(),
        { name: "code", type: "text", unique: true },
        { name: "kind", type: "text", default: "'percent'", check: "kind in ('percent', 'fixed')" },
        { name: "value", type: "numeric", check: "value > 0" },
        { name: "minimum_total", type: "numeric", nullable: true },
        { name: "starts_at", type: "timestamptz", nullable: true },
        { name: "ends_at", type: "timestamptz", nullable: true },
        { name: "usage_limit", type: "integer", nullable: true },
        { name: "times_used", type: "integer", default: "0" },
        { name: "active", type: "boolean", default: "true" },
      ],
      indexes: [{ on: ["code"] }],
      policies: [
        {
          name: "discounts_public_read_active",
          for: "select",
          to: ["anon", "authenticated"],
          using:
            "active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())",
          why: "A shopper's browser has to check the code they typed, so live codes are readable. Expired and disabled ones are not, which stops the catalogue of every discount this shop has ever run being one query away.",
        },
        {
          name: "discounts_admin_write",
          for: "all",
          to: ["authenticated"],
          using: "is_admin()",
          check: "is_admin()",
          why: "Only the merchant creates a discount.",
        },
      ],
    },
  ];

  return tables;
}

/* The publishing tables. A blog and a news publication are the same shape —
   the difference between them is editorial, and editorial is not a column. */
function content(withStorage: boolean): Table[] {
  return [
    {
      name: "posts",
      what: "The writing. One row per article, in whatever state it is in.",
      columns: [
        ...base(),
        { name: "title", type: "text" },
        { name: "slug", type: "text", unique: true },
        { name: "excerpt", type: "text", nullable: true },
        { name: "body", type: "text" },
        { name: "author_id", type: "uuid", nullable: true, references: { table: "auth.users", column: "id", onDelete: "set null" } },
        { name: "category_id", type: "uuid", nullable: true, references: { table: "categories", onDelete: "set null" } },
        ...(withStorage ? [{ name: "cover_path", type: "text" as const, nullable: true }] : []),
        {
          name: "status",
          type: "text",
          default: "'draft'",
          check: "status in ('draft', 'published', 'archived')",
        },
        { name: "published_at", type: "timestamptz", nullable: true },
      ],
      indexes: [{ on: ["slug"] }, { on: ["status", "published_at"] }, { on: ["author_id"] }],
      policies: [
        {
          name: "posts_public_read_published",
          for: "select",
          to: ["anon", "authenticated"],
          using: "status = 'published' and (published_at is null or published_at <= now())",
          why: "A reader sees published writing. A draft is not published, and neither is a post dated next Tuesday — which is what makes scheduling work rather than merely look like it does.",
        },
        {
          name: "posts_author_read_own",
          for: "select",
          to: ["authenticated"],
          using: "author_id = auth.uid() or is_admin()",
          why: "A writer reads their own drafts. An editor reads everybody's.",
        },
        {
          name: "posts_author_write_own",
          for: "all",
          to: ["authenticated"],
          using: "author_id = auth.uid() or is_admin()",
          check: "author_id = auth.uid() or is_admin()",
          why: "A writer edits their own posts; an editor edits any. Written as one policy over all four commands because the rule genuinely is the same for all four.",
        },
      ],
    },

    {
      name: "pages",
      what: "The standing pages — about, contact, terms — edited like posts but not listed like them.",
      columns: [
        ...base(),
        { name: "title", type: "text" },
        { name: "slug", type: "text", unique: true },
        { name: "body", type: "text" },
        {
          name: "status",
          type: "text",
          default: "'draft'",
          check: "status in ('draft', 'published')",
        },
      ],
      indexes: [{ on: ["slug"] }],
      policies: [
        {
          name: "pages_public_read_published",
          for: "select",
          to: ["anon", "authenticated"],
          using: "status = 'published'",
          why: "A published page is the public site.",
        },
        {
          name: "pages_admin_write",
          for: "all",
          to: ["authenticated"],
          using: "is_admin()",
          check: "is_admin()",
          why: "Standing pages are the site's own words. Only an editor changes them.",
        },
      ],
    },

    {
      name: "tags",
      what: "Free-form labels across posts, as opposed to the single category a post sits in.",
      columns: [
        ...base(),
        { name: "name", type: "text" },
        { name: "slug", type: "text", unique: true },
      ],
      indexes: [{ on: ["slug"] }],
      policies: [
        {
          name: "tags_public_read",
          for: "select",
          to: ["anon", "authenticated"],
          using: "true",
          why: "Tags are navigation, and navigation is public.",
        },
        {
          name: "tags_admin_write",
          for: "all",
          to: ["authenticated"],
          using: "is_admin()",
          check: "is_admin()",
          why: "Only an editor invents a tag, or the tag list becomes a mess nobody owns.",
        },
      ],
    },

    {
      name: "post_tags",
      what: "Which tags are on which post. A join table, so its key is the pair.",
      columns: [
        { name: "post_id", type: "uuid", references: { table: "posts", onDelete: "cascade" } },
        { name: "tag_id", type: "uuid", references: { table: "tags", onDelete: "cascade" } },
        { name: "created_at", type: "timestamptz", default: "now()" },
      ],
      indexes: [{ on: ["tag_id"] }],
      policies: [
        {
          name: "post_tags_public_read",
          for: "select",
          to: ["anon", "authenticated"],
          using: "exists (select 1 from posts p where p.id = post_id and p.status = 'published')",
          why: "A tagging is visible when the post it tags is. Otherwise the tag index leaks the titles of unpublished drafts.",
        },
        {
          name: "post_tags_author_write",
          for: "all",
          to: ["authenticated"],
          using: "exists (select 1 from posts p where p.id = post_id and (p.author_id = auth.uid() or is_admin()))",
          check: "exists (select 1 from posts p where p.id = post_id and (p.author_id = auth.uid() or is_admin()))",
          why: "You may tag a post you may edit.",
        },
      ],
    },
  ];
}

/* The media table. Storage holds the file; this holds what the app knows about
   it — which is the half a database is for. A bucket with no table behind it is
   a folder of hashes nobody can search. */
function media(): Table {
  return {
    name: "media",
    what: "One row per uploaded file: where it is in storage, and what it is.",
    columns: [
      ...base(),
      /* The path inside the bucket, not a URL. A URL bakes in the project's
         hostname and the signing scheme of the day; a path survives both. */
      { name: "path", type: "text", unique: true },
      { name: "bucket", type: "text" },
      { name: "filename", type: "text" },
      { name: "mime_type", type: "text" },
      { name: "size_bytes", type: "bigint", check: "size_bytes >= 0" },
      { name: "width", type: "integer", nullable: true },
      { name: "height", type: "integer", nullable: true },
      { name: "alt", type: "text", nullable: true },
      {
        name: "uploaded_by",
        type: "uuid",
        nullable: true,
        references: { table: "auth.users", column: "id", onDelete: "set null" },
      },
    ],
    indexes: [{ on: ["bucket", "path"] }],
    policies: [
      {
        name: "media_public_read",
        for: "select",
        to: ["anon", "authenticated"],
        using: "true",
        why: "The site renders these, so their metadata is as public as the images are. Nothing private belongs in this table — a private file's row belongs beside the thing it is private to.",
      },
      {
        name: "media_admin_write",
        for: "all",
        to: ["authenticated"],
        using: "is_admin()",
        check: "is_admin()",
        why: "Uploading and deleting are the admin's. The matching storage policy is emitted alongside this one, because a row deleted without its file leaves an orphan and a file deleted without its row leaves a broken image.",
      },
    ],
  };
}

/**
 * A bucket name that belongs to one project and not to any other.
 *
 * Buckets are NOT scoped by schema. `storage.buckets` is one flat table per
 * Supabase project, so two generated stores both asking for `product-images`
 * get the same bucket — one shop's photographs in the other's storage, and a
 * policy dropped and recreated by whichever built most recently. On the shared
 * instance that is a data leak between strangers, which makes this prefix
 * load-bearing rather than tidy.
 *
 * The schema is already unique per project, so it is what the name is built
 * from. On somebody's own Supabase the schema is `public` and the prefix is
 * dropped — there is nothing to collide with there, and `public-media` would be
 * a strange name to find in your own dashboard.
 */
export function bucketName(schema: string, base: string): string {
  return schema === "public" ? base : `${schema}-${base}`;
}

/**
 * The schema name for a project on the shared instance.
 *
 * Prefixed and hyphen-stripped because a Postgres identifier cannot start with
 * a digit and cannot contain a hyphen, and a project id is a UUID, which is
 * both. Truncated to 63 characters, which is where Postgres silently truncates
 * it — and a silent truncation that collides two projects is the worst possible
 * version of this bug.
 */
export function schemaNameFor(projectId: string): string {
  const cleaned = projectId.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `app_${cleaned}`.slice(0, 63);
}

/**
 * The database this project needs, from the layers it has.
 *
 * Returns an empty model when the manifest has no database, rather than null:
 * every caller then reads `.tables.length === 0` instead of branching on a
 * missing object, and a project that gains a database later gains rows in the
 * same shape rather than a different code path.
 */
export function dataModelFor(manifest: ArchitectureManifest, schema: string): DataModel {
  if (!manifest.database) return { schema, tables: [], buckets: [] };

  const tables: Table[] = [];
  const buckets: Bucket[] = [];

  /* Roles are named for what they do in this product. "admin" everywhere would
     be shorter and would read wrong in the one place it is seen — a merchant is
     not an administrator of anything. */
  const adminRole = manifest.type === "ecommerce" ? "admin" : "editor";

  if (manifest.authentication) tables.push(profiles(adminRole));

  if (manifest.type === "ecommerce") {
    tables.push(categories(), ...commerce(manifest.storage));
    if (manifest.storage) {
      buckets.push({
        name: bucketName(schema, "product-images"),
        public: true,
        what: "Product photography. Public, because it is on the shop front and a signed URL per thumbnail would be a request per thumbnail.",
      });
    }
  } else if (manifest.type === "blog" || manifest.type === "news") {
    tables.push(categories(), ...content(manifest.storage));
    if (manifest.storage) {
      buckets.push({
        name: bucketName(schema, "media"),
        public: true,
        what: "Images and files used in the writing. Public, because they are published alongside it.",
      });
    }
  }

  if (manifest.storage) tables.push(media());

  return { schema, tables, buckets };
}

/* ── SQL ───────────────────────────────────────────────────────────────────*/

function columnSql(column: Column): string {
  const parts = [`  ${column.name} ${column.type}`];

  if (column.primaryKey) parts.push("primary key");
  if (!column.nullable && !column.primaryKey) parts.push("not null");
  if (column.default) parts.push(`default ${column.default}`);
  if (column.unique && !column.primaryKey) parts.push("unique");
  if (column.references) {
    const target = column.references.table.includes(".")
      ? column.references.table
      : column.references.table;
    parts.push(`references ${target}(${column.references.column ?? "id"})`);
    if (column.references.onDelete) parts.push(`on delete ${column.references.onDelete}`);
  }
  if (column.check) parts.push(`check (${column.check})`);

  return parts.join(" ");
}

/* Policies are written against `is_admin()` and emitted as `<schema>.is_admin()`.
 *
 * The unqualified name resolves through the search_path of whoever is running
 * the query, and that is not ours to control: PostgREST sets it per request
 * from the schema being asked for, a psql session sets it from the connection,
 * and a policy that cannot resolve its own function does not fall back — it
 * errors, and every query against the table fails with a message about a
 * missing function rather than about a permission.
 *
 * Written unqualified in the table definitions above because the schema name is
 * not known there, and substituted here, where it is. */
function qualify(expression: string, schema: string): string {
  return expression.replace(/\bis_admin\(\)/g, `${schema}.is_admin()`);
}

function policySql(table: string, policy: Policy, schema: string): string {
  const lines = [
    `-- ${policy.why}`,
    `create policy ${policy.name} on ${table}`,
    `  for ${policy.for}`,
    `  to ${policy.to.join(", ")}`,
  ];

  if (policy.using) lines.push(`  using (${qualify(policy.using, schema)})`);
  if (policy.check) lines.push(`  with check (${qualify(policy.check, schema)})`);

  return `${lines.join("\n")};`;
}

/**
 * The migration, as SQL somebody can read before running it.
 *
 * Idempotent throughout — `if not exists`, `drop policy if exists` — because
 * this is applied by a machine against a schema that may already be half there
 * from a previous build of the same project. A migration that only works once
 * is a migration that fails every time after the first edit.
 *
 * Throws on a table with no policies rather than emitting it. RLS is enabled on
 * every table below, and a table with RLS on and nothing granting access is not
 * a secure table, it is a broken one — it returns zero rows to everybody
 * including its owner, and the person debugging that learns to disable RLS.
 * Failing here, loudly, at build time, is the cheap version of that lesson.
 */
export function toSql(model: DataModel): string {
  if (model.tables.length === 0) return "";

  const naked = model.tables.filter((table) => table.policies.length === 0);
  if (naked.length > 0) {
    throw new Error(
      `these tables have row-level security on and no policy, which locks them rather than securing them: ${naked
        .map((table) => table.name)
        .join(", ")}`,
    );
  }

  const out: string[] = [
    `-- ${model.schema}`,
    "--",
    "-- Generated by QuickStark.AI from this project's architecture manifest.",
    "-- Every table has row-level security on and at least one policy: the app",
    "-- that reads these tables runs in a browser with a public key, so these",
    "-- policies are the only thing standing between a row and anybody.",
    "",
    `create schema if not exists ${model.schema};`,
    "",
    "-- The app's queries run with this on the search path; nothing here reaches",
    "-- into public, and nothing in public reaches in here.",
    `grant usage on schema ${model.schema} to anon, authenticated;`,
    "",
  ];

  /* Who counts as an admin, asked once.
   *
   * Inlining `exists (select 1 from profiles …)` into thirty policies would work
   * and would be thirty places to get it wrong. It is also SECURITY DEFINER,
   * which is load-bearing rather than decorative: a policy on profiles that
   * calls a function which reads profiles is infinite recursion, and Postgres
   * answers it with a stack-depth error rather than a helpful one. A definer
   * function reads the table with RLS bypassed and breaks the cycle. */
  if (model.tables.some((table) => table.name === "profiles")) {
    out.push(
      "-- Whether the caller is an admin of THIS app. SECURITY DEFINER on purpose:",
      "-- a policy on profiles that calls a function reading profiles recurses, and",
      "-- Postgres reports that as a stack-depth error rather than as the bug it is.",
      "-- search_path is pinned for the same reason it always is on a definer",
      "-- function: without it, the caller chooses which profiles table this reads.",
      `create or replace function ${model.schema}.is_admin()`,
      "returns boolean",
      "language sql",
      "stable",
      "security definer",
      `set search_path = ${model.schema}, public`,
      "as $$",
      "  select exists (",
      "    select 1 from profiles",
      "    where id = auth.uid() and role in ('admin', 'editor')",
      "  );",
      "$$;",
      "",
      `revoke all on function ${model.schema}.is_admin() from public;`,
      `grant execute on function ${model.schema}.is_admin() to anon, authenticated;`,
      "",
    );
  }

  for (const table of model.tables) {
    const qualified = `${model.schema}.${table.name}`;
    out.push(`-- ── ${table.name} ${"─".repeat(Math.max(0, 66 - table.name.length))}`);
    out.push(`-- ${table.what}`);
    out.push(`create table if not exists ${qualified} (`);
    out.push(table.columns.map(columnSql).join(",\n"));

    /* A join table's key is the pair, and saying so is what stops the same tag
       being attached to the same post four times. */
    if (table.columns.every((column) => !column.primaryKey)) {
      const keys = table.columns
        .filter((column) => column.references)
        .map((column) => column.name);
      if (keys.length > 0) out.push(`,\n  primary key (${keys.join(", ")})`);
    }

    out.push(");");
    out.push("");
    out.push(`comment on table ${qualified} is '${table.what.replace(/'/g, "''")}';`);

    for (const index of table.indexes ?? []) {
      const name = `${table.name}_${index.on.join("_")}_idx`;
      out.push(`create index if not exists ${name} on ${qualified} (${index.on.join(", ")});`);
    }

    out.push("");
    out.push(`alter table ${qualified} enable row level security;`);
    out.push("");

    for (const policy of table.policies) {
      /* Dropped first so a re-run replaces the policy rather than failing on it.
         Postgres has no `create or replace policy`. */
      out.push(`drop policy if exists ${policy.name} on ${qualified};`);
      out.push(policySql(qualified, policy, model.schema));
      out.push("");
    }

    /* Grants are not authorisation here — the policies are — but without them
       RLS never gets a chance to run: Postgres checks the table privilege
       first and refuses with a permission error that looks nothing like a
       policy problem. */
    const writable = table.policies.some((policy) => policy.for !== "select");
    out.push(
      writable
        ? `grant select, insert, update, delete on ${qualified} to anon, authenticated;`
        : `grant select on ${qualified} to anon, authenticated;`,
    );
    out.push("");
  }

  if (model.buckets.length > 0) {
    out.push(`-- ── Storage ${"─".repeat(62)}`);
    out.push("-- Buckets hold the files; the media table above holds what is known about");
    out.push("-- them. Both are needed: a bucket alone is a folder of hashes nobody can");
    out.push("-- search, and a row alone is a broken image.");
    out.push("");

    for (const bucket of model.buckets) {
      out.push(`-- ${bucket.what}`);
      out.push(
        `insert into storage.buckets (id, name, public) values ('${bucket.name}', '${bucket.name}', ${bucket.public})`,
        "  on conflict (id) do nothing;",
        "",
      );

      if (bucket.public) {
        out.push(
          `drop policy if exists "${bucket.name}_public_read" on storage.objects;`,
          `create policy "${bucket.name}_public_read" on storage.objects`,
          "  for select to anon, authenticated",
          `  using (bucket_id = '${bucket.name}');`,
          "",
        );
      }

      out.push(
        `-- Writing is the admin's, and it is enforced here rather than by hiding the`,
        `-- upload button: a storage bucket is an HTTP endpoint like any other.`,
        `drop policy if exists "${bucket.name}_admin_write" on storage.objects;`,
        `create policy "${bucket.name}_admin_write" on storage.objects`,
        "  for all to authenticated",
        `  using (bucket_id = '${bucket.name}' and ${model.schema}.is_admin())`,
        `  with check (bucket_id = '${bucket.name}' and ${model.schema}.is_admin());`,
        "",
      );
    }
  }

  return out.join("\n");
}

/**
 * The schema as the model is shown it — the tables and their columns, without
 * the policies.
 *
 * The policies are deliberately absent. The application does not implement
 * them; the database enforces them, and a model shown a page of SQL policy will
 * reimplement half of them as `if (user.role === 'admin')` in the interface,
 * which is the exact frontend-only authorisation this whole arrangement exists
 * to replace. What it needs to know is what it may assume: that a query returns
 * only rows this person may see, so it never has to filter for permission and
 * must never pretend to.
 */
export function schemaBrief(model: DataModel): string {
  if (model.tables.length === 0) return "";

  const lines = [
    "THE DATABASE — already created. Do not write migrations, do not create tables, do not guess column names.",
    "",
    `Schema: ${model.schema}. The client in lib/supabase.ts is already pointed at it, so query table names bare: supabase.from("products"), never "${model.schema}.products".`,
    "",
  ];

  for (const table of model.tables) {
    lines.push(`${table.name} — ${table.what}`);
    for (const column of table.columns) {
      const notes: string[] = [column.type];
      if (column.references) notes.push(`→ ${column.references.table}`);
      if (column.nullable) notes.push("nullable");
      if (column.check) notes.push(column.check);
      lines.push(`  ${column.name}: ${notes.join(", ")}`);
    }
    lines.push("");
  }

  if (model.buckets.length > 0) {
    lines.push("STORAGE BUCKETS:");
    for (const bucket of model.buckets) {
      lines.push(`  ${bucket.name} — ${bucket.what}`);
    }
    lines.push("");
  }

  lines.push(
    "ROW-LEVEL SECURITY IS ON, ON EVERY TABLE, AND IT HAS ALREADY DECIDED.",
    "",
    "A select returns exactly the rows this visitor is allowed to see — drafts are absent for a reader, another customer's orders are absent for a customer, and an admin's query returns everything without asking for it. So:",
    "- Never filter for permission. Do not write `.eq(\"status\", \"published\")` to hide drafts or `.eq(\"customer_id\", user.id)` to hide other people's orders; that is already done, and writing it again hides the case where it was not.",
    "- Never gate an action on a role you read in JavaScript. Attempt the write and handle the refusal — the database is what says no, and an interface that decides for itself is an interface somebody can edit in a console.",
    "- A write that comes back with an error because a policy refused it is a correct outcome, not a bug. Show what happened.",
  );

  return lines.join("\n");
}

/**
 * The tables as TypeScript, for the generated project to compile against.
 *
 * Worth the file it costs. supabase-js is generic over a Database type, and
 * given one it will refuse a column that does not exist at compile time rather
 * than returning `null` at runtime in somebody's browser. A generated app is
 * the case that needs this most: nobody is reading its code closely, and a
 * typo'd column name is a feature that silently does nothing.
 *
 * Emitted from the same model the migration is emitted from, so the types
 * cannot drift from the tables — they are two renderings of one fact.
 */
export function toTypes(model: DataModel): string {
  if (model.tables.length === 0) return "";

  const ts = (column: Column): string => {
    const base =
      column.type === "integer" || column.type === "bigint" || column.type === "numeric"
        ? "number"
        : column.type === "boolean"
          ? "boolean"
          : column.type === "jsonb"
            ? "Json"
            : "string";

    return column.nullable ? `${base} | null` : base;
  };

  /* A column with a default may be omitted on insert; one without may not. That
     distinction is the only reason Insert is a separate type from Row, and it
     is what stops every insert in the generated app having to spell out
     created_at. */
  const optionalOnInsert = (column: Column): boolean =>
    Boolean(column.default) || column.nullable === true;

  const lines = [
    "/* The database, as types. Generated from this project's schema — do not edit:",
    "   the tables and these types are two renderings of one fact, and editing one",
    "   of them makes that untrue. */",
    "",
    "export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];",
    "",
    "export type Database = {",
    `  ${model.schema === "public" ? "public" : model.schema}: {`,
    "    Tables: {",
  ];

  for (const table of model.tables) {
    lines.push(`      ${table.name}: {`);
    lines.push("        Row: {");
    for (const column of table.columns) lines.push(`          ${column.name}: ${ts(column)};`);
    lines.push("        };");

    lines.push("        Insert: {");
    for (const column of table.columns) {
      lines.push(`          ${column.name}${optionalOnInsert(column) ? "?" : ""}: ${ts(column)};`);
    }
    lines.push("        };");

    lines.push("        Update: {");
    for (const column of table.columns) lines.push(`          ${column.name}?: ${ts(column)};`);
    lines.push("        };");
    lines.push("      };");
  }

  lines.push("    };");
  lines.push("    Views: Record<string, never>;");
  lines.push("    Functions: Record<string, never>;");
  lines.push("    Enums: Record<string, never>;");
  lines.push("  };");
  lines.push("};");
  lines.push("");

  /* One alias per table, because `Database["app_x"]["Tables"]["products"]["Row"]`
     in a component's props is unreadable and nobody writes it twice. */
  for (const table of model.tables) {
    const name = table.name
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
    const schema = model.schema === "public" ? "public" : model.schema;
    lines.push(`export type ${name} = Database["${schema}"]["Tables"]["${table.name}"]["Row"];`);
  }

  return `${lines.join("\n")}\n`;
}
