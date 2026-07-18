CREATE TABLE IF NOT EXISTS storage_upload_issues (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    issue_type TEXT NOT NULL,
    bucket TEXT NOT NULL,
    path TEXT NOT NULL,
    user_id BIGINT NULL,
    message TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    request_context JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_storage_upload_issues_created_at ON storage_upload_issues (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_storage_upload_issues_user_id ON storage_upload_issues (user_id);
CREATE INDEX IF NOT EXISTS idx_storage_upload_issues_issue_type ON storage_upload_issues (issue_type);
