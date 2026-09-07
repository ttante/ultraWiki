import { pathToFileURL } from 'node:url';
import { Pool, type PoolClient, type QueryResult } from 'pg';

export type DataRepairScope =
  | 'profile_records'
  | 'learning_saved_packs'
  | 'share_link_tokens'
  | 'quiz_attempt_sequences';

export type DataRepairItem = {
  scope: DataRepairScope;
  description: string;
  rows: number;
};

export type DataRepairReport = {
  dryRun: boolean;
  generatedAt: string;
  items: DataRepairItem[];
  totalRows: number;
};

type Queryable = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<QueryResult<T>>;
};

const referencedUsersCte = `
WITH referenced_users AS (
  SELECT user_id FROM saved_packs
  UNION
  SELECT owner_user_id AS user_id FROM share_links
  UNION
  SELECT user_id FROM flashcard_reviews
  UNION
  SELECT user_id FROM learning_sessions
  UNION
  SELECT user_id FROM quiz_attempts
  UNION
  SELECT user_id FROM study_goals
),
normalized_users AS (
  SELECT DISTINCT TRIM(user_id) AS user_id
  FROM referenced_users
  WHERE user_id IS NOT NULL AND TRIM(user_id) <> ''
)
`;

const learningPackRefsCte = `
WITH learning_pack_refs AS (
  SELECT user_id, pack_id FROM flashcard_reviews
  UNION
  SELECT user_id, pack_id FROM learning_sessions
  UNION
  SELECT user_id, pack_id FROM quiz_attempts
),
normalized_refs AS (
  SELECT DISTINCT user_id, pack_id
  FROM learning_pack_refs
  WHERE user_id IS NOT NULL AND TRIM(user_id) <> ''
)
`;

const quizSequenceCte = `
WITH ordered AS (
  SELECT
    id,
    user_id,
    pack_id,
    submitted_at,
    accuracy,
    card_mastery_score,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, pack_id
      ORDER BY submitted_at ASC, id ASC
    ) AS expected_attempt_number,
    LAG(accuracy) OVER (
      PARTITION BY user_id, pack_id
      ORDER BY submitted_at ASC, id ASC
    ) AS expected_previous_accuracy
  FROM quiz_attempts
),
scored AS (
  SELECT
    id,
    user_id,
    pack_id,
    submitted_at,
    expected_attempt_number,
    expected_previous_accuracy,
    LEAST(1, GREATEST(0, accuracy)) AS expected_normalized_accuracy,
    LEAST(1, GREATEST(0, card_mastery_score)) AS expected_normalized_card_mastery,
    CASE
      WHEN expected_previous_accuracy IS NULL THEN 0
      ELSE ROUND((LEAST(1, GREATEST(0, accuracy)) - expected_previous_accuracy)::numeric, 4)::double precision
    END AS expected_accuracy_delta,
    ROUND(
      ((LEAST(1, GREATEST(0, accuracy)) + LEAST(1, GREATEST(0, card_mastery_score))) / 2)::numeric,
      4
    )::double precision AS expected_mastery_score
  FROM ordered
),
scored_with_previous AS (
  SELECT
    *,
    LAG(expected_mastery_score) OVER (
      PARTITION BY user_id, pack_id
      ORDER BY submitted_at ASC, id ASC
    ) AS expected_previous_mastery_score
  FROM scored
),
expected AS (
  SELECT
    id,
    expected_attempt_number,
    expected_previous_accuracy,
    expected_previous_mastery_score,
    expected_accuracy_delta,
    expected_mastery_score,
    ROUND(
      (
        expected_mastery_score - COALESCE(expected_previous_mastery_score, expected_normalized_card_mastery)
      )::numeric,
      4
    )::double precision AS expected_mastery_delta
  FROM scored_with_previous
)
`;

const countRows = (result: QueryResult<Record<string, unknown>>, key = 'count'): number =>
  Number(result.rows[0]?.[key] ?? 0);

const buildReport = (dryRun: boolean, items: DataRepairItem[]): DataRepairReport => ({
  dryRun,
  generatedAt: new Date().toISOString(),
  items,
  totalRows: items.reduce((total, item) => total + item.rows, 0)
});

export const collectDataRepairDryRun = async (client: Queryable): Promise<DataRepairReport> => {
  const profileRecords = await client.query(
    `${referencedUsersCte}
     SELECT COUNT(*)::int AS count
     FROM normalized_users users
     LEFT JOIN user_profiles profiles ON profiles.user_id = users.user_id
     WHERE profiles.user_id IS NULL`
  );

  const learningSavedPacks = await client.query(
    `${learningPackRefsCte}
     SELECT COUNT(*)::int AS count
     FROM normalized_refs refs
     JOIN study_packs packs ON packs.id = refs.pack_id
     LEFT JOIN saved_packs saved ON saved.user_id = refs.user_id AND saved.pack_id = refs.pack_id
     WHERE saved.pack_id IS NULL`
  );

  const shareLinkTokens = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM share_links
     WHERE token_hash IS NULL OR token_version IS NULL OR TRIM(token_version) = ''`
  );

  const quizAttemptSequences = await client.query(
    `${quizSequenceCte}
     SELECT COUNT(*)::int AS count
     FROM quiz_attempts
     JOIN expected USING (id)
     WHERE quiz_attempts.attempt_number IS DISTINCT FROM expected.expected_attempt_number
        OR quiz_attempts.previous_accuracy IS DISTINCT FROM expected.expected_previous_accuracy
        OR quiz_attempts.accuracy_delta IS DISTINCT FROM expected.expected_accuracy_delta
        OR quiz_attempts.mastery_score IS DISTINCT FROM expected.expected_mastery_score
        OR quiz_attempts.mastery_delta IS DISTINCT FROM expected.expected_mastery_delta`
  );

  return buildReport(true, [
    {
      scope: 'profile_records',
      description: 'Create missing local profile rows for referenced user ids.',
      rows: countRows(profileRecords)
    },
    {
      scope: 'learning_saved_packs',
      description: 'Create missing saved-pack links for users with learning progress records.',
      rows: countRows(learningSavedPacks)
    },
    {
      scope: 'share_link_tokens',
      description: 'Backfill legacy share token metadata for share links missing token hash/version fields.',
      rows: countRows(shareLinkTokens)
    },
    {
      scope: 'quiz_attempt_sequences',
      description: 'Recompute quiz retake attempt numbers, previous accuracy, deltas, and mastery snapshots.',
      rows: countRows(quizAttemptSequences)
    }
  ]);
};

export const applyDataRepairs = async (client: Queryable): Promise<DataRepairReport> => {
  const profileRecords = await client.query(
    `${referencedUsersCte}
     INSERT INTO user_profiles (user_id, display_name)
     SELECT users.user_id, users.user_id
     FROM normalized_users users
     LEFT JOIN user_profiles profiles ON profiles.user_id = users.user_id
     WHERE profiles.user_id IS NULL
     ON CONFLICT DO NOTHING
     RETURNING user_id`
  );

  const learningSavedPacks = await client.query(
    `${learningPackRefsCte}
     INSERT INTO saved_packs (user_id, pack_id)
     SELECT refs.user_id, refs.pack_id
     FROM normalized_refs refs
     JOIN study_packs packs ON packs.id = refs.pack_id
     LEFT JOIN saved_packs saved ON saved.user_id = refs.user_id AND saved.pack_id = refs.pack_id
     WHERE saved.pack_id IS NULL
     ON CONFLICT DO NOTHING
     RETURNING user_id, pack_id`
  );

  const shareLinkTokens = await client.query(
    `UPDATE share_links
     SET token_hash = COALESCE(token_hash, 'legacy-md5:' || md5(share_id::text)),
         token_version = COALESCE(NULLIF(TRIM(token_version), ''), 'legacy-md5')
     WHERE token_hash IS NULL OR token_version IS NULL OR TRIM(token_version) = ''
     RETURNING share_id`
  );

  const quizAttemptSequences = await client.query(
    `${quizSequenceCte}
     UPDATE quiz_attempts
     SET attempt_number = expected.expected_attempt_number,
         previous_accuracy = expected.expected_previous_accuracy,
         accuracy_delta = expected.expected_accuracy_delta,
         mastery_score = expected.expected_mastery_score,
         mastery_delta = expected.expected_mastery_delta
     FROM expected
     WHERE quiz_attempts.id = expected.id
       AND (
         quiz_attempts.attempt_number IS DISTINCT FROM expected.expected_attempt_number
         OR quiz_attempts.previous_accuracy IS DISTINCT FROM expected.expected_previous_accuracy
         OR quiz_attempts.accuracy_delta IS DISTINCT FROM expected.expected_accuracy_delta
         OR quiz_attempts.mastery_score IS DISTINCT FROM expected.expected_mastery_score
         OR quiz_attempts.mastery_delta IS DISTINCT FROM expected.expected_mastery_delta
       )
     RETURNING quiz_attempts.id`
  );

  return buildReport(false, [
    {
      scope: 'profile_records',
      description: 'Created missing local profile rows for referenced user ids.',
      rows: profileRecords.rowCount ?? profileRecords.rows.length
    },
    {
      scope: 'learning_saved_packs',
      description: 'Created missing saved-pack links for users with learning progress records.',
      rows: learningSavedPacks.rowCount ?? learningSavedPacks.rows.length
    },
    {
      scope: 'share_link_tokens',
      description: 'Backfilled legacy share token metadata for share links missing token hash/version fields.',
      rows: shareLinkTokens.rowCount ?? shareLinkTokens.rows.length
    },
    {
      scope: 'quiz_attempt_sequences',
      description: 'Recomputed quiz retake attempt numbers, previous accuracy, deltas, and mastery snapshots.',
      rows: quizAttemptSequences.rowCount ?? quizAttemptSequences.rows.length
    }
  ]);
};

const runApplyTransaction = async (client: PoolClient): Promise<DataRepairReport> => {
  await client.query('BEGIN');
  try {
    const report = await applyDataRepairs(client);
    await client.query('COMMIT');
    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
};

const run = async (): Promise<void> => {
  const apply = process.argv.includes('--apply') || process.env.DATA_REPAIR_APPLY === '1';
  const dryRun = !apply;
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    let report: DataRepairReport;
    if (dryRun) {
      report = await collectDataRepairDryRun(pool);
    } else {
      const client = await pool.connect();
      try {
        report = await runApplyTransaction(client);
      } finally {
        client.release();
      }
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void run();
}
