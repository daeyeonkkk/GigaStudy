"""add arrangements

Revision ID: 20260407_0004
Revises: 20260407_0003
Create Date: 2026-04-07 20:05:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260407_0004"
down_revision: str | None = "20260407_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "arrangements",
        sa.Column("arrangement_id", sa.Uuid(), nullable=False),
        sa.Column("generation_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("melody_draft_id", sa.Uuid(), nullable=False),
        sa.Column("candidate_code", sa.String(length=8), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("input_source_type", sa.String(length=32), nullable=False),
        sa.Column("style", sa.String(length=32), nullable=False),
        sa.Column("difficulty", sa.String(length=32), nullable=False),
        sa.Column("voice_mode", sa.String(length=24), nullable=False),
        sa.Column("part_count", sa.Integer(), nullable=False),
        sa.Column("constraint_json", sa.JSON(), nullable=True),
        sa.Column("parts_json", sa.JSON(), nullable=False),
        sa.Column("midi_storage_key", sa.String(length=512), nullable=True),
        sa.Column("midi_byte_size", sa.Integer(), nullable=True),
        sa.Column("musicxml_storage_key", sa.String(length=512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["melody_draft_id"], ["melody_drafts.melody_draft_id"], name=op.f("fk_arrangements_melody_draft_id_melody_drafts")),
        sa.ForeignKeyConstraint(["project_id"], ["projects.project_id"], name=op.f("fk_arrangements_project_id_projects")),
        sa.PrimaryKeyConstraint("arrangement_id", name=op.f("pk_arrangements")),
    )
    op.create_index(op.f("ix_arrangements_generation_id"), "arrangements", ["generation_id"], unique=False)
    op.create_index(op.f("ix_arrangements_project_id"), "arrangements", ["project_id"], unique=False)
    op.create_index(op.f("ix_arrangements_melody_draft_id"), "arrangements", ["melody_draft_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_arrangements_melody_draft_id"), table_name="arrangements")
    op.drop_index(op.f("ix_arrangements_project_id"), table_name="arrangements")
    op.drop_index(op.f("ix_arrangements_generation_id"), table_name="arrangements")
    op.drop_table("arrangements")
