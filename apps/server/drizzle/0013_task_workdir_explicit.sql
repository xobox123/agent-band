ALTER TABLE "tasks" ADD COLUMN "work_dir_explicit" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
-- Legacy tasks did not store provenance. Recognize generated paths under the current
-- workspace root; preserve unmatched paths and subtasks as explicit. Renamed schedules
-- and changed workspace roots cannot be recovered, nor can explicit paths identical
-- to generated paths be distinguished without historical provenance.
-- Normalize absolute roots like node:path.join before matching generated folders.
WITH RECURSIVE workspace_paths AS (
  SELECT "id", regexp_split_to_array("workspace_root", '/+') AS segments,
         1 AS position, ARRAY[]::text[] AS normalized
  FROM "organizations"
  WHERE "workspace_root" IS NOT NULL
  UNION ALL
  SELECT "id", segments, position + 1,
         CASE
           WHEN segments[position] IN ('', '.') THEN normalized
           WHEN segments[position] = '..' THEN normalized[1:greatest(cardinality(normalized) - 1, 0)]
           ELSE array_append(normalized, segments[position])
         END
  FROM workspace_paths
  WHERE position <= cardinality(segments)
), workspace_roots AS (
  SELECT "id", rtrim('/' || array_to_string(normalized, '/'), '/') AS root
  FROM workspace_paths
  WHERE position > cardinality(segments)
)
UPDATE "tasks" AS t
SET "work_dir_explicit" = false
FROM workspace_roots AS o
WHERE t."org_id" = o."id"
  AND t."parent_task_id" IS NULL
  AND (
    (t."schedule_id" IS NULL AND t."work_dir" = o.root || '/' || regexp_replace(t."key", '[^a-zA-Z0-9._-]+', '-', 'g'))
    OR EXISTS (
      SELECT 1 FROM "schedules" AS s
      WHERE s."org_id" = t."org_id"
        AND s."id" = t."schedule_id"
        AND s."template"->>'workDir' IS NULL
        AND t."work_dir" = o.root || '/' || coalesce(
          nullif(left(trim(both '-' FROM regexp_replace(lower(s."name"), '[^a-z0-9]+', '-', 'g')), 60), ''),
          'schedule'
        )
    )
  );
