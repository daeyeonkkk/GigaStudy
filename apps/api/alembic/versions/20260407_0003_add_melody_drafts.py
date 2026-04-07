"""add melody drafts

Revision ID: 20260407_0003
Revises: 20260407_0002
Create Date: 2026-04-07 19:20:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260407_0003"
down_revision: str | None = "20260407_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "melody_drafts",
        sa.Column("melody_draft_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("track_id", sa.Uuid(), nullable=False),
        sa.Column("model_version", sa.String(length=80), nullable=False),
        sa.Column("key_estimate", sa.String(length=32), nullable=True),
        sa.Column("bpm", sa.Integer(), nullable=True),
        sa.Column("grid_division", sa.String(length=16), nullable=False),
        sa.Column("phrase_count", sa.Integer(), nullable=False),
        sa.Column("note_count", sa.Integer(), nullable=False),
        sa.Column("notes_json", sa.JSON(), nullable=False),
        sa.Column("midi_storage_key", sa.String(length=512), nullable=True),
        sa.Column("midi_byte_size", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.project_id"], name=op.f("fk_melody_drafts_project_id_projects")),
        sa.ForeignKeyConstraint(["track_id"], ["tracks.track_id"], name=op.f("fk_melody_drafts_track_id_tracks")),
        sa.PrimaryKeyConstraint("melody_draft_id", name=op.f("pk_melody_drafts")),
    )
    op.create_index(op.f("ix_melody_drafts_project_id"), "melody_drafts", ["project_id"], unique=False)
    op.create_index(op.f("ix_melody_drafts_track_id"), "melody_drafts", ["track_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_melody_drafts_track_id"), table_name="melody_drafts")
    op.drop_index(op.f("ix_melody_drafts_project_id"), table_name="melody_drafts")
    op.drop_table("melody_drafts")
