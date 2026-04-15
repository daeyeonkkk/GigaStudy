"""add runtime events

Revision ID: 20260415_0011
Revises: 20260408_0010
Create Date: 2026-04-15 18:10:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260415_0011"
down_revision: str | None = "20260408_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "runtime_events",
        sa.Column("runtime_event_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=True),
        sa.Column("track_id", sa.Uuid(), nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("surface", sa.String(length=64), nullable=True),
        sa.Column("route_path", sa.String(length=256), nullable=True),
        sa.Column("request_method", sa.String(length=16), nullable=True),
        sa.Column("request_path", sa.String(length=512), nullable=True),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("message", sa.String(length=2000), nullable=False),
        sa.Column("user_agent", sa.String(length=1024), nullable=True),
        sa.Column("details_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.project_id"]),
        sa.ForeignKeyConstraint(["track_id"], ["tracks.track_id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.user_id"]),
        sa.PrimaryKeyConstraint("runtime_event_id"),
    )
    op.create_index(op.f("ix_runtime_events_user_id"), "runtime_events", ["user_id"], unique=False)
    op.create_index(op.f("ix_runtime_events_project_id"), "runtime_events", ["project_id"], unique=False)
    op.create_index(op.f("ix_runtime_events_track_id"), "runtime_events", ["track_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_runtime_events_track_id"), table_name="runtime_events")
    op.drop_index(op.f("ix_runtime_events_project_id"), table_name="runtime_events")
    op.drop_index(op.f("ix_runtime_events_user_id"), table_name="runtime_events")
    op.drop_table("runtime_events")
