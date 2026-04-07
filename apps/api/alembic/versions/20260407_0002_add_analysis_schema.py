"""add analysis schema

Revision ID: 20260407_0002
Revises: 20260407_0001
Create Date: 2026-04-07 18:20:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260407_0002"
down_revision: str | None = "20260407_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


analysis_job_type = sa.Enum(
    "POST_RECORDING_SCORE",
    name="analysis_job_type",
    native_enum=False,
)
analysis_job_status = sa.Enum(
    "QUEUED",
    "RUNNING",
    "SUCCEEDED",
    "FAILED",
    name="analysis_job_status",
    native_enum=False,
)


def upgrade() -> None:
    op.add_column("tracks", sa.Column("alignment_offset_ms", sa.Integer(), nullable=True))
    op.add_column("tracks", sa.Column("alignment_confidence", sa.Float(), nullable=True))

    op.create_table(
        "analysis_jobs",
        sa.Column("job_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("track_id", sa.Uuid(), nullable=False),
        sa.Column("job_type", analysis_job_type, nullable=False),
        sa.Column("status", analysis_job_status, nullable=False),
        sa.Column("model_version", sa.String(length=80), nullable=False),
        sa.Column("requested_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.String(length=1024), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.project_id"], name=op.f("fk_analysis_jobs_project_id_projects")),
        sa.ForeignKeyConstraint(["track_id"], ["tracks.track_id"], name=op.f("fk_analysis_jobs_track_id_tracks")),
        sa.PrimaryKeyConstraint("job_id", name=op.f("pk_analysis_jobs")),
    )
    op.create_index(op.f("ix_analysis_jobs_project_id"), "analysis_jobs", ["project_id"], unique=False)
    op.create_index(op.f("ix_analysis_jobs_track_id"), "analysis_jobs", ["track_id"], unique=False)

    op.create_table(
        "scores",
        sa.Column("score_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("track_id", sa.Uuid(), nullable=False),
        sa.Column("pitch_score", sa.Float(), nullable=False),
        sa.Column("rhythm_score", sa.Float(), nullable=False),
        sa.Column("harmony_fit_score", sa.Float(), nullable=False),
        sa.Column("total_score", sa.Float(), nullable=False),
        sa.Column("feedback_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.project_id"], name=op.f("fk_scores_project_id_projects")),
        sa.ForeignKeyConstraint(["track_id"], ["tracks.track_id"], name=op.f("fk_scores_track_id_tracks")),
        sa.PrimaryKeyConstraint("score_id", name=op.f("pk_scores")),
    )
    op.create_index(op.f("ix_scores_project_id"), "scores", ["project_id"], unique=False)
    op.create_index(op.f("ix_scores_track_id"), "scores", ["track_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_scores_track_id"), table_name="scores")
    op.drop_index(op.f("ix_scores_project_id"), table_name="scores")
    op.drop_table("scores")

    op.drop_index(op.f("ix_analysis_jobs_track_id"), table_name="analysis_jobs")
    op.drop_index(op.f("ix_analysis_jobs_project_id"), table_name="analysis_jobs")
    op.drop_table("analysis_jobs")

    op.drop_column("tracks", "alignment_confidence")
    op.drop_column("tracks", "alignment_offset_ms")
