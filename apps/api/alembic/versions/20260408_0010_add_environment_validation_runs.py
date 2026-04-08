"""add environment validation runs

Revision ID: 20260408_0010
Revises: 20260408_0009
Create Date: 2026-04-08 23:10:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260408_0010"
down_revision: str | None = "20260408_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "environment_validation_runs",
        sa.Column("validation_run_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("label", sa.String(length=160), nullable=False),
        sa.Column("tester", sa.String(length=120), nullable=True),
        sa.Column("device_name", sa.String(length=160), nullable=False),
        sa.Column("os", sa.String(length=80), nullable=False),
        sa.Column("browser", sa.String(length=80), nullable=False),
        sa.Column("input_device", sa.String(length=160), nullable=True),
        sa.Column("output_route", sa.String(length=160), nullable=True),
        sa.Column(
            "outcome",
            sa.Enum("PASS", "WARN", "FAIL", name="validation_outcome", native_enum=False),
            nullable=False,
        ),
        sa.Column("secure_context", sa.Boolean(), nullable=True),
        sa.Column("microphone_permission_before", sa.String(length=32), nullable=True),
        sa.Column("microphone_permission_after", sa.String(length=32), nullable=True),
        sa.Column("recording_mime_type", sa.String(length=64), nullable=True),
        sa.Column("audio_context_mode", sa.String(length=32), nullable=True),
        sa.Column("offline_audio_context_mode", sa.String(length=32), nullable=True),
        sa.Column("actual_sample_rate", sa.Integer(), nullable=True),
        sa.Column("base_latency", sa.Float(), nullable=True),
        sa.Column("output_latency", sa.Float(), nullable=True),
        sa.Column("warning_flags_json", sa.JSON(), nullable=True),
        sa.Column("take_recording_succeeded", sa.Boolean(), nullable=True),
        sa.Column("analysis_succeeded", sa.Boolean(), nullable=True),
        sa.Column("playback_succeeded", sa.Boolean(), nullable=True),
        sa.Column("audible_issues", sa.String(length=2000), nullable=True),
        sa.Column("permission_issues", sa.String(length=2000), nullable=True),
        sa.Column("unexpected_warnings", sa.String(length=2000), nullable=True),
        sa.Column("follow_up", sa.String(length=2000), nullable=True),
        sa.Column("notes", sa.String(length=4000), nullable=True),
        sa.Column("validated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.user_id"]),
        sa.PrimaryKeyConstraint("validation_run_id"),
    )
    op.create_index(
        op.f("ix_environment_validation_runs_user_id"),
        "environment_validation_runs",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_environment_validation_runs_user_id"), table_name="environment_validation_runs")
    op.drop_table("environment_validation_runs")
