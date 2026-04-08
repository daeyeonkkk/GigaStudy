"""add project chord timeline

Revision ID: 20260408_0008
Revises: 20260408_0007
Create Date: 2026-04-08 20:05:00
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "20260408_0008"
down_revision: str | None = "20260408_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("chord_timeline_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("projects", "chord_timeline_json")
