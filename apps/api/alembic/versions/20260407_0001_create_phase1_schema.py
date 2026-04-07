"""create phase 1 schema

Revision ID: 20260407_0001
Revises:
Create Date: 2026-04-07 12:45:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260407_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


track_role = sa.Enum("GUIDE", "VOCAL_TAKE", "MIXDOWN", name="track_role", native_enum=False)
track_status = sa.Enum(
    "PENDING_UPLOAD",
    "UPLOADING",
    "READY",
    "FAILED",
    name="track_status",
    native_enum=False,
)
artifact_type = sa.Enum(
    "SOURCE_AUDIO",
    "CANONICAL_AUDIO",
    "WAVEFORM_PEAKS",
    "MIXDOWN_AUDIO",
    name="artifact_type",
    native_enum=False,
)


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("nickname", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_users")),
        sa.UniqueConstraint("nickname", name=op.f("uq_users_nickname")),
    )
    op.create_table(
        "projects",
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("bpm", sa.Integer(), nullable=True),
        sa.Column("base_key", sa.String(length=24), nullable=True),
        sa.Column("time_signature", sa.String(length=24), nullable=True),
        sa.Column("mode", sa.String(length=40), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.user_id"], name=op.f("fk_projects_user_id_users")),
        sa.PrimaryKeyConstraint("project_id", name=op.f("pk_projects")),
    )
    op.create_index(op.f("ix_projects_user_id"), "projects", ["user_id"], unique=False)
    op.create_table(
        "device_profiles",
        sa.Column("device_profile_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("browser", sa.String(length=80), nullable=False),
        sa.Column("os", sa.String(length=80), nullable=False),
        sa.Column("input_device_hash", sa.String(length=128), nullable=False),
        sa.Column("output_route", sa.String(length=128), nullable=False),
        sa.Column("requested_constraints_json", sa.JSON(), nullable=True),
        sa.Column("applied_settings_json", sa.JSON(), nullable=True),
        sa.Column("actual_sample_rate", sa.Integer(), nullable=True),
        sa.Column("channel_count", sa.Integer(), nullable=True),
        sa.Column("input_latency_est", sa.Float(), nullable=True),
        sa.Column("base_latency", sa.Float(), nullable=True),
        sa.Column("output_latency", sa.Float(), nullable=True),
        sa.Column("calibration_method", sa.String(length=64), nullable=True),
        sa.Column("calibration_confidence", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.user_id"], name=op.f("fk_device_profiles_user_id_users")),
        sa.PrimaryKeyConstraint("device_profile_id", name=op.f("pk_device_profiles")),
        sa.UniqueConstraint(
            "user_id",
            "browser",
            "os",
            "input_device_hash",
            "output_route",
            name="uq_device_profiles_user_device_route",
        ),
    )
    op.create_index(op.f("ix_device_profiles_user_id"), "device_profiles", ["user_id"], unique=False)
    op.create_table(
        "tracks",
        sa.Column("track_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("track_role", track_role, nullable=False),
        sa.Column("track_status", track_status, nullable=False),
        sa.Column("part_type", sa.String(length=32), nullable=True),
        sa.Column("take_no", sa.Integer(), nullable=True),
        sa.Column("actual_sample_rate", sa.Integer(), nullable=True),
        sa.Column("storage_key", sa.String(length=512), nullable=True),
        sa.Column("source_format", sa.String(length=64), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("checksum", sa.String(length=128), nullable=True),
        sa.Column("recording_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recording_finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.project_id"], name=op.f("fk_tracks_project_id_projects")),
        sa.PrimaryKeyConstraint("track_id", name=op.f("pk_tracks")),
    )
    op.create_index(op.f("ix_tracks_project_id"), "tracks", ["project_id"], unique=False)
    op.create_table(
        "artifacts",
        sa.Column("artifact_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("track_id", sa.Uuid(), nullable=True),
        sa.Column("artifact_type", artifact_type, nullable=False),
        sa.Column("storage_key", sa.String(length=512), nullable=False),
        sa.Column("url", sa.String(length=1024), nullable=True),
        sa.Column("mime_type", sa.String(length=128), nullable=True),
        sa.Column("byte_size", sa.Integer(), nullable=True),
        sa.Column("meta_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.project_id"], name=op.f("fk_artifacts_project_id_projects")),
        sa.ForeignKeyConstraint(["track_id"], ["tracks.track_id"], name=op.f("fk_artifacts_track_id_tracks")),
        sa.PrimaryKeyConstraint("artifact_id", name=op.f("pk_artifacts")),
    )
    op.create_index(op.f("ix_artifacts_project_id"), "artifacts", ["project_id"], unique=False)
    op.create_index(op.f("ix_artifacts_track_id"), "artifacts", ["track_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_artifacts_track_id"), table_name="artifacts")
    op.drop_index(op.f("ix_artifacts_project_id"), table_name="artifacts")
    op.drop_table("artifacts")
    op.drop_index(op.f("ix_tracks_project_id"), table_name="tracks")
    op.drop_table("tracks")
    op.drop_index(op.f("ix_device_profiles_user_id"), table_name="device_profiles")
    op.drop_table("device_profiles")
    op.drop_index(op.f("ix_projects_user_id"), table_name="projects")
    op.drop_table("projects")
    op.drop_table("users")
