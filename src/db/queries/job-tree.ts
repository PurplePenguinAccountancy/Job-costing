import { sql } from "drizzle-orm";
import { withTenant, type db as Db } from "@/db";
import { jobs } from "@/db/schema";

export type JobTreeRow = {
  id: string;
  parentId: string | null;
  code: string;
  name: string;
  depth: number;
  path: string[];
};

/** A new job node — a real job like any other, root-level unless parentId is given (brief section 3: no special-casing). */
export async function createJob(tenantId: string, input: { code: string; name: string; parentId?: string | null }) {
  const [job] = await withTenant(tenantId, null, (tx) =>
    tx
      .insert(jobs)
      .values({ tenantId, code: input.code, name: input.name, parentId: input.parentId ?? null })
      .returning(),
  );
  return job;
}

/**
 * All descendants of a job (excluding the job itself), via recursive CTE.
 * Unlimited depth by design — the job tree has no fixed number of levels.
 */
export async function getJobDescendants(db: typeof Db, tenantId: string, jobId: string) {
  const result = await db.execute<JobTreeRow>(sql`
    with recursive descendants as (
      select id, parent_id, code, name, 0 as depth, array[id] as path
      from jobs
      where tenant_id = ${tenantId} and id = ${jobId}
      union all
      select j.id, j.parent_id, j.code, j.name, d.depth + 1, d.path || j.id
      from jobs j
      inner join descendants d on j.parent_id = d.id
      where j.tenant_id = ${tenantId}
    )
    select id, parent_id as "parentId", code, name, depth, path
    from descendants
    where depth > 0
    order by path;
  `);
  return result;
}

/** All ancestors of a job (excluding the job itself), root-first. */
export async function getJobAncestors(db: typeof Db, tenantId: string, jobId: string) {
  const result = await db.execute<JobTreeRow>(sql`
    with recursive ancestors as (
      select id, parent_id, code, name, 0 as depth
      from jobs
      where tenant_id = ${tenantId} and id = ${jobId}
      union all
      select j.id, j.parent_id, j.code, j.name, a.depth + 1
      from jobs j
      inner join ancestors a on j.id = a.parent_id
      where j.tenant_id = ${tenantId}
    )
    select id, parent_id as "parentId", code, name, depth, array[]::uuid[] as path
    from ancestors
    where depth > 0
    order by depth desc;
  `);
  return result;
}

/**
 * The full tenant job tree in one pass, depth-first ordered — the shape
 * most UI job-tree views want directly, without N ancestor/descendant calls.
 */
export async function getFullJobTree(db: typeof Db, tenantId: string) {
  const result = await db.execute<JobTreeRow>(sql`
    with recursive tree as (
      select id, parent_id, code, name, 0 as depth, array[code] as path
      from jobs
      where tenant_id = ${tenantId} and parent_id is null
      union all
      select j.id, j.parent_id, j.code, j.name, t.depth + 1, t.path || j.code
      from jobs j
      inner join tree t on j.parent_id = t.id
      where j.tenant_id = ${tenantId}
    )
    select id, parent_id as "parentId", code, name, depth, path
    from tree
    order by path;
  `);
  return result;
}
